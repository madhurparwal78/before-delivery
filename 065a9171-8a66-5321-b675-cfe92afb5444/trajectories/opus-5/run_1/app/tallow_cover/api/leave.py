"""Leave requests, the approval queue, the staffing preview and posting cover."""

from __future__ import annotations

from datetime import datetime, time
from decimal import Decimal

from flask import Blueprint, request

from .. import emails, projections
from ..db import execute, row, rows
from ..domain import audit
from ..domain.leave import (
    AWAITING_DECISION,
    LEAVE_TYPES,
    MAX_LENGTH_DAYS,
    ensure_transition,
    holiday,
    is_short_notice,
    notice_multiplier,
    overlapping_request,
    request_cost,
    rostered_hours_in,
    within_one_leave_year,
)
from ..domain.preview import breach_detail, load_staffing, preview_body
from ..domain.roster import person_assignments
from ..errors import ApiError, floor_breach
from ..projections import LEAVE_SELECT
from ..records import load_cover, load_leave_request
from ..responses import api_response
from ..timeutil import (
    SHIFTS,
    days_inclusive,
    format_short_label,
    london_wall_clock,
    now_utc,
    parse_date,
    shift_window,
    today_london,
    week_bounds,
)
from .common import (
    endpoint,
    new_id,
    read_body,
    require_roles,
    resolve_home,
    visible_home_ids,
)

blueprint = Blueprint("leave", __name__)

QUEUE_STATUSES = (
    "open",
    "submitted",
    "escalated",
    "cover_pending",
    "approved",
    "declined",
    "withdrawn",
    "cancelled",
)
COUNTED_STATUSES = ("submitted", "escalated", "cover_pending", "approved", "declined")
NOTE_MAX = 500
REASON_MAX = 500


def _visible_request(conn, person: dict, request_id: str, for_update: bool = False) -> dict:
    record = load_leave_request(conn, request_id, for_update=for_update)
    if record is None:
        raise ApiError("not_found")
    if record["requester_id"] == person["id"] or person["role"] == "hr_admin":
        return record
    if person["role"] == "unit_manager" and record["home_id"] == person["home_id"]:
        return record
    raise ApiError("not_found")


def _own_request(conn, person: dict, request_id: str, for_update: bool = False) -> dict:
    record = load_leave_request(conn, request_id, for_update=for_update)
    if record is None or record["requester_id"] != person["id"]:
        raise ApiError("not_found")
    return record


def _validate_dates(body, start, end, today) -> None:
    if start is None:
        body.fail("start_date", "leave_start_past")
    elif start < today:
        body.fail("start_date", "leave_start_past")
    if end is None:
        body.fail("end_date", "end_before_start")
    elif start is not None:
        if end < start:
            body.fail("end_date", "end_before_start")
        elif days_inclusive(start, end) > MAX_LENGTH_DAYS:
            body.fail("end_date", "too_many_days")
        elif not within_one_leave_year(start, end):
            body.fail("end_date", "crosses_leave_year")


def _validate_note(body, note) -> None:
    if note is not None and (not isinstance(note, str) or len(note) > NOTE_MAX):
        body.fail("note", "note_too_long")


def _check_balance(conn, body, person: dict, record: dict, today) -> None:
    """Submitting an annual request that would take the balance below zero is refused."""
    if record["leave_type"] != "annual":
        return
    cost = request_cost(conn, record)
    balance = holiday(conn, person, today)
    remaining = Decimal(balance["remaining_hours"])
    if cost > remaining:
        body.fail_with(
            "end_date", f"This needs {cost:.2f} hours but you have {remaining:.2f} hours left."
        )


def _cancel_open_covers(conn, request_id: str) -> None:
    execute(
        conn,
        """UPDATE cover_shifts SET status = 'cancelled'
           WHERE leave_request_id = %s AND status = 'open'""",
        (request_id,),
    )


def _first_affected_start(conn, record: dict) -> datetime:
    """When the request's first affected shift starts, or midnight on its first day."""
    starts = [
        shift_window(assignment["shift_date"], assignment["shift"])[0]
        for assignment in person_assignments(
            conn, record["requester_id"], record["start_date"], record["end_date"]
        )
    ]
    if starts:
        return min(starts)
    return london_wall_clock(record["start_date"], time(0, 0))


def _reread(conn, record: dict):
    return api_response(projections.leave_request(conn, load_leave_request(conn, record["id"])))


@blueprint.get("/api/me/leave-requests")
@endpoint()
def my_requests(conn, person):
    require_roles(person, "care_worker", "unit_manager")
    records = rows(
        conn,
        f"{LEAVE_SELECT} WHERE r.requester_id = %s ORDER BY r.created_at DESC",
        (person["id"],),
    )
    return api_response({"items": [projections.leave_request(conn, record) for record in records]})


@blueprint.get("/api/leave-requests/<request_id>")
@endpoint()
def read_request(conn, person, request_id):
    record = _visible_request(conn, person, request_id)
    return api_response(projections.leave_request(conn, record))


@blueprint.post("/api/leave-requests")
@endpoint(write=True)
def create_request(conn, person):
    body = read_body("type", "start_date", "end_date", "note", "submit")
    require_roles(person, "care_worker", "unit_manager")
    today = today_london()
    leave_type = body.get("type")
    if leave_type not in LEAVE_TYPES:
        body.fail("type", "type")
    start = parse_date(body.get("start_date"))
    end = parse_date(body.get("end_date"))
    _validate_dates(body, start, end, today)
    note = body.get("note")
    _validate_note(body, note)
    submit = body.get("submit") is True
    body.check()

    request_id = new_id("lrq")
    execute(
        conn,
        """INSERT INTO leave_requests (id, requester_id, home_id, unit_id, leave_type,
                                       start_date, end_date, note, status, hours)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'draft', %s)""",
        (
            request_id,
            person["id"],
            person["home_id"],
            person["unit_id"],
            leave_type,
            start,
            end,
            note,
            rostered_hours_in(conn, person["id"], start, end),
        ),
    )
    if submit:
        _submit(conn, person, load_leave_request(conn, request_id), body, today)
    return api_response(projections.leave_request(conn, load_leave_request(conn, request_id)), 201)


def _submit(conn, person: dict, record: dict, body, today) -> None:
    """Every validation runs again when a draft is submitted."""
    if overlapping_request(
        conn, person["id"], record["start_date"], record["end_date"], record["id"]
    ):
        raise ApiError("overlaps_existing_leave")
    hours = rostered_hours_in(conn, person["id"], record["start_date"], record["end_date"])
    execute(conn, "UPDATE leave_requests SET hours = %s WHERE id = %s", (hours, record["id"]))
    record = dict(record, hours=hours)
    _validate_dates(body, record["start_date"], record["end_date"], today)
    _validate_note(body, record["note"])
    _check_balance(conn, body, person, record, today)
    body.check()
    length_days = days_inclusive(record["start_date"], record["end_date"])
    multiplier = notice_multiplier(conn, record["home_id"], today)
    execute(
        conn,
        """UPDATE leave_requests
           SET status = 'submitted', submitted_at = %s, short_notice = %s
           WHERE id = %s""",
        (
            now_utc(),
            is_short_notice(record["start_date"], length_days, today, multiplier),
            record["id"],
        ),
    )


@blueprint.patch("/api/leave-requests/<request_id>")
@endpoint(write=True)
def edit_request(conn, person, request_id):
    body = read_body("type", "start_date", "end_date", "note")
    record = _own_request(conn, person, request_id, for_update=True)
    ensure_transition(record["status"], "edited")
    today = today_london()
    leave_type = record["leave_type"]
    if body.has("type"):
        leave_type = body.get("type")
        if leave_type not in LEAVE_TYPES:
            body.fail("type", "type")
    start = record["start_date"]
    end = record["end_date"]
    if body.has("start_date"):
        start = parse_date(body.get("start_date"))
    if body.has("end_date"):
        end = parse_date(body.get("end_date"))
    _validate_dates(body, start, end, today)
    note = body.get("note") if body.has("note") else record["note"]
    _validate_note(body, note)
    body.check()
    execute(
        conn,
        """UPDATE leave_requests SET leave_type = %s, start_date = %s, end_date = %s,
                                     note = %s, hours = %s
           WHERE id = %s""",
        (
            leave_type,
            start,
            end,
            note,
            rostered_hours_in(conn, person["id"], start, end),
            request_id,
        ),
    )
    return _reread(conn, record)


@blueprint.post("/api/leave-requests/<request_id>/submit")
@endpoint(write=True)
def submit_request(conn, person, request_id):
    body = read_body()
    record = _own_request(conn, person, request_id, for_update=True)
    ensure_transition(record["status"], "submitted")
    _submit(conn, person, record, body, today_london())
    return _reread(conn, record)


@blueprint.post("/api/leave-requests/<request_id>/withdraw")
@endpoint(write=True)
def withdraw_request(conn, person, request_id):
    body = read_body()
    record = _own_request(conn, person, request_id, for_update=True)
    ensure_transition(record["status"], "withdrawn")
    if record["status"] == "approved" and now_utc() >= _first_affected_start(conn, record):
        raise ApiError("already_started")
    body.check()
    execute(conn, "UPDATE leave_requests SET status = 'withdrawn' WHERE id = %s", (request_id,))
    _cancel_open_covers(conn, request_id)
    return _reread(conn, record)


@blueprint.post("/api/leave-requests/<request_id>/approve")
@endpoint(write=True)
def approve_request(conn, person, request_id):
    body = read_body("override_reason")
    record = _visible_request(conn, person, request_id, for_update=True)
    require_roles(person, "unit_manager", "hr_admin")
    if record["requester_id"] == person["id"]:
        raise ApiError("own_request")
    ensure_transition(record["status"], "approved")
    override_reason = body.get("override_reason")
    if override_reason is not None and (
        not isinstance(override_reason, str) or not 1 <= len(override_reason) <= REASON_MAX
    ):
        body.fail("override_reason", "reason")
    breaches = []
    if record["unit_id"]:
        row(conn, "SELECT id FROM units WHERE id = %s FOR UPDATE", (record["unit_id"],))
        breaches = load_staffing(conn, record, record["start_date"]).breaches()
    if breaches and override_reason is None:
        raise floor_breach([breach_detail(entry) for _day, _shift, entry in breaches])
    body.check()
    execute(
        conn,
        """UPDATE leave_requests SET status = 'approved', decided_at = %s, decided_by = %s,
                                     decision_reason = %s
           WHERE id = %s""",
        (now_utc(), person["id"], override_reason, request_id),
    )
    if breaches:
        before = projections.leave_request(conn, record)
        after = projections.leave_request(conn, load_leave_request(conn, request_id))
        after["breach_labels"] = [
            format_short_label(day, shift) for day, shift, _entry in breaches
        ]
        audit.write_entry(
            conn,
            actor=person,
            action="floor_override",
            home_id=record["home_id"],
            target_type="leave_request",
            target_id=request_id,
            before=before,
            after=after,
            reason=override_reason,
        )
    emails.leave_approved(conn, record["requester_email"], record, person["display_name"])
    return _reread(conn, record)


@blueprint.post("/api/leave-requests/<request_id>/decline")
@endpoint(write=True)
def decline_request(conn, person, request_id):
    body = read_body("reason")
    record = _visible_request(conn, person, request_id, for_update=True)
    require_roles(person, "unit_manager", "hr_admin")
    if record["requester_id"] == person["id"]:
        raise ApiError("own_request")
    ensure_transition(record["status"], "declined")
    reason = body.get("reason")
    if not isinstance(reason, str) or not 1 <= len(reason) <= REASON_MAX:
        body.fail("reason", "reason")
    body.check()
    execute(
        conn,
        """UPDATE leave_requests SET status = 'declined', decided_at = %s, decided_by = %s,
                                     decision_reason = %s
           WHERE id = %s""",
        (now_utc(), person["id"], reason, request_id),
    )
    _cancel_open_covers(conn, request_id)
    emails.leave_declined(conn, record["requester_email"], record, reason)
    return _reread(conn, record)


@blueprint.post("/api/leave-requests/<request_id>/cancel")
@endpoint(write=True)
def cancel_request(conn, person, request_id):
    body = read_body("reason")
    record = _visible_request(conn, person, request_id, for_update=True)
    require_roles(person, "hr_admin")
    ensure_transition(record["status"], "cancelled")
    reason = body.get("reason")
    if not isinstance(reason, str) or not 1 <= len(reason) <= REASON_MAX:
        body.fail("reason", "reason")
    body.check()
    before = projections.leave_request(conn, record)
    execute(
        conn,
        """UPDATE leave_requests SET status = 'cancelled', decided_at = %s, decided_by = %s,
                                     decision_reason = %s
           WHERE id = %s""",
        (now_utc(), person["id"], reason, request_id),
    )
    _cancel_open_covers(conn, request_id)
    after = projections.leave_request(conn, load_leave_request(conn, request_id))
    audit.write_entry(
        conn,
        actor=person,
        action="leave_cancelled",
        home_id=record["home_id"],
        target_type="leave_request",
        target_id=request_id,
        before=before,
        after=after,
        reason=reason,
    )
    emails.leave_cancelled(conn, record["requester_email"], record, reason)
    return _reread(conn, record)


@blueprint.get("/api/leave-requests/<request_id>/preview")
@endpoint()
def preview_request(conn, person, request_id):
    record = _visible_request(conn, person, request_id)
    require_roles(person, "unit_manager", "hr_admin")
    body = read_body()
    raw_from = request.args.get("from")
    page_from = record["start_date"] if raw_from is None else parse_date(raw_from)
    if page_from is None or not record["start_date"] <= page_from <= record["end_date"]:
        body.fail("from", "from")
    body.check()
    return api_response(preview_body(conn, record, page_from))


def _eligible_bank_carers(conn, home_id: str, skill: str) -> list[dict]:
    """Credentialed for the home, and holding senior when the cover needs one."""
    senior_only = " AND p.skill = 'senior'" if skill == "senior" else ""
    return rows(
        conn,
        f"""SELECT p.id, p.email FROM people p
            JOIN bank_credentials c ON c.person_id = p.id
            WHERE p.role = 'bank_carer' AND c.home_id = %s{senior_only}
            ORDER BY p.id""",
        (home_id,),
    )


@blueprint.post("/api/leave-requests/<request_id>/covers")
@endpoint(write=True)
def post_cover(conn, person, request_id):
    body = read_body("date", "shift", "skill")
    record = _visible_request(conn, person, request_id, for_update=True)
    require_roles(person, "unit_manager", "hr_admin")
    if record["requester_id"] == person["id"]:
        raise ApiError("own_request")
    ensure_transition(record["status"], "given cover")
    shift_date = parse_date(body.get("date"))
    shift = body.get("shift")
    skill = body.get("skill")
    if record["unit_id"] is None or shift_date is None or shift not in SHIFTS:
        raise ApiError("no_open_gap")
    row(conn, "SELECT id FROM units WHERE id = %s FOR UPDATE", (record["unit_id"],))
    entry = load_staffing(conn, record, shift_date).shift_entry(shift_date, shift)
    if not any(gap["skill"] == skill and gap["cover"] is None for gap in entry["gaps"]):
        raise ApiError("no_open_gap")
    body.check()
    cover_id = new_id("cov")
    execute(
        conn,
        """INSERT INTO cover_shifts (id, leave_request_id, home_id, unit_id, shift_date,
                                     shift, skill, status)
           VALUES (%s, %s, %s, %s, %s, %s, %s, 'open')""",
        (
            cover_id,
            request_id,
            record["home_id"],
            record["unit_id"],
            shift_date,
            shift,
            skill,
        ),
    )
    execute(
        conn,
        "UPDATE leave_requests SET status = 'cover_pending' WHERE id = %s",
        (request_id,),
    )
    unit = row(
        conn,
        """SELECT u.name AS unit_name, h.name AS home_name FROM units u
           JOIN homes h ON h.id = u.home_id WHERE u.id = %s""",
        (record["unit_id"],),
    )
    for carer in _eligible_bank_carers(conn, record["home_id"], skill):
        emails.cover_open(
            conn,
            carer["email"],
            unit["home_name"],
            unit["unit_name"],
            shift_date,
            shift,
            skill,
        )
    return api_response(projections.cover(load_cover(conn, cover_id), person["role"]), 201)


@blueprint.get("/api/queue")
@endpoint()
def read_queue(conn, person):
    body = read_body()
    raw_home = request.args.get("home")
    home_id = resolve_home(conn, person, raw_home)["id"] if raw_home else None
    require_roles(person, "unit_manager", "hr_admin")
    if home_id is None:
        homes = visible_home_ids(conn, person)
        home_id = person["home_id"] or (homes[0] if homes else None)
    status_filter = request.args.get("status") or "open"
    if status_filter not in QUEUE_STATUSES:
        body.fail("status", "queue_status")
    raw_week = request.args.get("week")
    week = week_bounds(raw_week) if raw_week else None
    body.check()

    clauses = ["r.home_id = %s", "r.status <> 'draft'"]
    params: list = [home_id]
    if week:
        clauses.append("r.start_date <= %s AND r.end_date >= %s")
        params.extend([week[1], week[0]])
    where = " AND ".join(clauses)
    counted = rows(
        conn, f"{LEAVE_SELECT} WHERE {where} ORDER BY r.submitted_at, r.id", tuple(params)
    )
    wanted = AWAITING_DECISION if status_filter == "open" else (status_filter,)
    items = [record for record in counted if record["status"] in wanted]
    return api_response(
        {
            "home_id": home_id,
            "counts": {
                status: sum(1 for record in counted if record["status"] == status)
                for status in COUNTED_STATUSES
            },
            "items": [projections.leave_request(conn, record) for record in items],
        }
    )
