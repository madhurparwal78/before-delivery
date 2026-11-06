"""Sickness records, fit-note uploads and signed fit-note downloads."""

from __future__ import annotations

from datetime import timedelta

from flask import Blueprint, request

from .. import projections, storage
from ..db import execute, rows
from ..domain.sickness import (
    EXTENSIONS,
    FIT_NOTE_AFTER_DAYS,
    MAX_BACKDATED_DAYS,
    MAX_FIT_NOTE_BYTES,
    detect_file_type,
    needs_fit_note,
    safe_file_name,
)
from ..errors import ApiError, invalid_transition, unsupported_file
from ..records import SICKNESS_SELECT, load_fit_note, load_sickness
from ..responses import api_response
from ..timeutil import days_inclusive, parse_date, today_london
from .common import endpoint, new_id, read_body, require_roles

blueprint = Blueprint("sickness", __name__)

REASON_MAX = 500


def _refresh_status(conn, record: dict, today) -> dict:
    """The seven-day rule bites on any read, not only on the sweep."""
    if needs_fit_note(record, today):
        execute(
            conn,
            "UPDATE sickness_records SET status = 'fit_note_required' WHERE id = %s",
            (record["id"],),
        )
        record = dict(record, status="fit_note_required")
    return record


def _project(conn, record: dict, person: dict, today) -> dict:
    is_owner = record["person_id"] == person["id"]
    return projections.sickness(
        record,
        today,
        person["role"],
        is_owner,
        projections.fit_note(load_fit_note(conn, record["id"])),
    )


def _visible_sickness(conn, person: dict, sickness_id: str) -> dict:
    record = load_sickness(conn, sickness_id)
    if record is None:
        raise ApiError("not_found")
    if record["person_id"] == person["id"] or person["role"] == "hr_admin":
        return record
    if person["role"] == "unit_manager" and record["home_id"] == person["home_id"]:
        return record
    raise ApiError("not_found")


def _own_sickness(conn, person: dict, sickness_id: str, for_update: bool = False) -> dict:
    record = load_sickness(conn, sickness_id, for_update=for_update)
    if record is None or record["person_id"] != person["id"]:
        raise ApiError("not_found")
    return record


@blueprint.get("/api/me/sickness")
@endpoint(write=True)
def my_sickness(conn, person):
    require_roles(person, "care_worker")
    today = today_london()
    records = [
        _refresh_status(conn, record, today)
        for record in rows(
            conn,
            f"{SICKNESS_SELECT} WHERE s.person_id = %s ORDER BY s.start_date DESC, s.id",
            (person["id"],),
        )
    ]
    return api_response({"items": [_project(conn, record, person, today) for record in records]})


@blueprint.get("/api/sickness/<sickness_id>")
@endpoint(write=True)
def read_sickness(conn, person, sickness_id):
    today = today_london()
    record = _refresh_status(conn, _visible_sickness(conn, person, sickness_id), today)
    return api_response(_project(conn, record, person, today))


@blueprint.post("/api/sickness")
@endpoint(write=True)
def report_sickness(conn, person):
    body = read_body("start_date", "reason")
    require_roles(person, "care_worker")
    today = today_london()
    start = parse_date(body.get("start_date"))
    if start is None or not today - timedelta(days=MAX_BACKDATED_DAYS) <= start <= today:
        body.fail("start_date", "sickness_start")
    reason = body.get("reason")
    if not isinstance(reason, str) or not 1 <= len(reason) <= REASON_MAX:
        body.fail("reason", "reason")
    body.check()
    sickness_id = new_id("sik")
    status = (
        "fit_note_required" if days_inclusive(start, today) > FIT_NOTE_AFTER_DAYS else "reported"
    )
    execute(
        conn,
        """INSERT INTO sickness_records (id, person_id, home_id, start_date, status, reason)
           VALUES (%s, %s, %s, %s, %s, %s)""",
        (sickness_id, person["id"], person["home_id"], start, status, reason),
    )
    return api_response(_project(conn, load_sickness(conn, sickness_id), person, today), 201)


@blueprint.post("/api/sickness/<sickness_id>/fit-note")
@endpoint(write=True)
def upload_fit_note(conn, person, sickness_id):
    today = today_london()
    record = _refresh_status(
        conn, _own_sickness(conn, person, sickness_id, for_update=True), today
    )
    if record["status"] not in ("reported", "fit_note_required"):
        raise invalid_transition(record["status"], "given a fit note")
    uploaded = request.files.get("file")
    content = uploaded.read() if uploaded else b""
    if len(content) > MAX_FIT_NOTE_BYTES:
        raise ApiError("too_large")
    content_type = detect_file_type(content)
    if content_type is None:
        raise unsupported_file()
    upload_id = new_id("upl")
    file_name = safe_file_name(uploaded.filename or "fit-note")
    key = f"fit-notes/{record['home_id']}/{record['id']}/{upload_id}.{EXTENSIONS[content_type]}"
    stored = "stored"
    try:
        storage.put_object(key, content, content_type)
    except OSError:
        stored = "pending"
    execute(
        conn,
        """INSERT INTO uploads (id, sickness_id, file_name, content_type, storage_key,
                                storage, content)
           VALUES (%s, %s, %s, %s, %s, %s, %s)""",
        (upload_id, record["id"], file_name, content_type, key, stored, content),
    )
    execute(
        conn, "UPDATE sickness_records SET status = 'evidenced' WHERE id = %s", (record["id"],)
    )
    return api_response(_project(conn, load_sickness(conn, sickness_id), person, today), 201)


@blueprint.get("/api/sickness/<sickness_id>/fit-note")
@endpoint()
def download_fit_note(conn, person, sickness_id):
    record = _visible_sickness(conn, person, sickness_id)
    if record["person_id"] != person["id"]:
        require_roles(person, "hr_admin")
    upload = load_fit_note(conn, record["id"])
    if upload is None:
        raise ApiError("not_found")
    if upload["storage"] != "stored":
        raise ApiError("storage_pending")
    return api_response(
        {
            "url": storage.presign_get(
                upload["storage_key"], upload["content_type"], upload["file_name"]
            ),
            "expires_in_seconds": storage.SIGNED_DOWNLOAD_SECONDS,
        }
    )


@blueprint.post("/api/sickness/<sickness_id>/return")
@endpoint(write=True)
def record_return(conn, person, sickness_id):
    body = read_body("last_sick_date")
    today = today_london()
    record = _refresh_status(
        conn, _own_sickness(conn, person, sickness_id, for_update=True), today
    )
    if record["status"] == "closed":
        raise invalid_transition(record["status"], "edited")
    last_sick_date = parse_date(body.get("last_sick_date"))
    if last_sick_date is None or not record["start_date"] <= last_sick_date <= today:
        body.fail("last_sick_date", "last_sick_date")
    elif record["status"] != "evidenced":
        closed_span = days_inclusive(record["start_date"], last_sick_date)
        if closed_span > FIT_NOTE_AFTER_DAYS:
            raise ApiError("fit_note_missing")
    body.check()
    execute(
        conn,
        "UPDATE sickness_records SET last_sick_date = %s, status = 'closed' WHERE id = %s",
        (last_sick_date, record["id"]),
    )
    return api_response(_project(conn, load_sickness(conn, sickness_id), person, today))
