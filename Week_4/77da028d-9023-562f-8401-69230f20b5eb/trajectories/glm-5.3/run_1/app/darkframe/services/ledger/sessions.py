"""Sessions, batches, idempotency, locks, notes, frames, calibration links."""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta, timezone
from typing import Any

from starlette.requests import Request
from starlette.responses import JSONResponse

from darkframe.common.http import ApiError, gen_id, read_json
from darkframe.common.validate import FILTERS
from darkframe.services.ledger.api import (
    batch_body, db, frame_body, now_utc, project_body, session_body,
    _batch_of, _project_of, _session_of, _post_movement, _latest_unreversed_log,
)
from darkframe.services.ledger.projects import imager
from darkframe.services.ledger.sites import zone_from_header

UPLOAD_LIMIT = 20_000_000
IDEMPOTENCY_TTL = timedelta(hours=24)


def _body_hash(body: dict) -> str:
    return hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()


def _parse_started_at(raw: Any, zone, message: str = "Started at must be an ISO 8601 instant.") -> datetime:
    if not isinstance(raw, str):
        raise ApiError(422, "validation", message, {"started_at": message})
    text = raw.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        raise ApiError(422, "validation", message, {"started_at": message})
    if parsed.tzinfo is None:
        raise ApiError(422, "validation", message, {"started_at": message})
    return parsed.astimezone(timezone.utc)


def _observing_date_of(started_utc: datetime, zone) -> str:
    local = started_utc.astimezone(zone)
    if local.hour >= 12:
        return local.strftime("%Y-%m-%d")
    return (local - timedelta(days=1)).strftime("%Y-%m-%d") if False else _prev_date(local)


def _prev_date(local: datetime) -> str:

    d = local.date() - td(days=1)
    return d.isoformat()


def _validate_batch_fields(body: dict, filters_allowed: set[str], prefix: str = "") -> dict:
    fields: dict[str, str] = {}
    filt = body.get("filter")
    if filt not in FILTERS or (filters_allowed and filt not in filters_allowed):
        key = f"{prefix}filter" if not prefix else f"{prefix}filter"
        fields[key] = "This filter is not planned for the project."
    sub = body.get("sub_count")
    if not isinstance(sub, int) or isinstance(sub, bool) or not (1 <= sub <= 10000):
        fields[f"{prefix}sub_count"] = "Sub count must be a whole number between 1 and 10,000."
    exposure = body.get("exposure_s")
    if not isinstance(exposure, int) or isinstance(exposure, bool) or not (1 <= exposure <= 3600):
        fields[f"{prefix}exposure_s"] = "Exposure must be a whole number of seconds between 1 and 3,600."
    camera = body.get("camera")
    if not isinstance(camera, str) or not (1 <= len(camera) <= 60):
        fields[f"{prefix}camera"] = "Camera must be between 1 and 60 characters."
    gain = body.get("gain")
    if not isinstance(gain, int) or isinstance(gain, bool) or not (0 <= gain <= 1000):
        fields[f"{prefix}gain"] = "Gain must be a whole number between 0 and 1,000."
    offset = body.get("offset")
    if not isinstance(offset, int) or isinstance(offset, bool) or not (0 <= offset <= 1000):
        fields[f"{prefix}offset"] = "Offset must be a whole number between 0 and 1,000."
    temp = body.get("temperature_c")
    if isinstance(temp, bool) or not isinstance(temp, (int, float)) or not (-40 <= temp <= 40) or round(temp, 1) != temp:
        fields[f"{prefix}temperature_c"] = "Sensor temperature must be between -40 and 40 with at most one decimal."
    binning = body.get("binning")
    if not isinstance(binning, int) or isinstance(binning, bool) or not (1 <= binning <= 4):
        fields[f"{prefix}binning"] = "Binning must be 1, 2, 3 or 4."
    if fields:
        raise ApiError(422, "validation", "Check the highlighted fields.", fields)
    return {
        "filter": filt, "sub_count": sub, "exposure_s": exposure, "camera": camera,
        "gain": gain, "offset": offset, "temperature_c": round(float(temp), 1), "binning": binning,
    }


def _integration(b: dict) -> int:
    return b["sub_count"] * b["exposure_s"]


def _planned_filters(cursor, project_id: str) -> set[str]:
    rows = cursor.execute(
        "SELECT DISTINCT filter FROM entries WHERE project_id=%s AND account='allotment' AND seconds <> 0",
        (project_id,),
    ).fetchall()
    return {r["filter"] for r in rows}


# ---------------------------------------------------------------------------
# Sessions


async def list_sessions(request: Request):
    ident = imager(request)
    project_id = request.query_params.get("project_id")
    include_trashed = request.query_params.get("include_trashed") == "true"

    def fn(cursor):
        if project_id:
            _project_of(cursor, project_id, ident)
        sql = "SELECT * FROM sessions WHERE imager_id=%s"
        params: list[Any] = [ident]
        if project_id:
            sql += " AND project_id=%s"
            params.append(project_id)
        if not include_trashed:
            sql += " AND state <> 'trashed'"
        sql += " ORDER BY observing_date DESC, created_at DESC"
        rows = cursor.execute(sql, tuple(params)).fetchall()
        return {"sessions": [session_body(cursor, dict(r)) for r in rows]}
    return JSONResponse(db().run_in_transaction(fn))


async def create_session(request: Request):
    ident = imager(request)
    body = await read_json(request)
    from darkframe.services.ledger.sites import zone_from_header

    zone = zone_from_header(request)
    fields: dict[str, str] = {}
    project_id = body.get("project_id")
    if not isinstance(project_id, str):
        fields["project_id"] = "Choose a project for the session."
    observing = body.get("observing_date")
    if not isinstance(observing, str) or not _is_date(observing):
        fields["observing_date"] = "The observing date must be a real YYYY-MM-DD date."
    notes = body.get("notes", "")
    if not isinstance(notes, str) or len(notes) > 10_000:
        fields["notes"] = "Notes must be at most 10,000 characters."
    if fields:
        raise ApiError(422, "validation", "Check the highlighted fields.", fields)

    def fn(cursor):
        project = _project_of(cursor, project_id, ident)
        if project["state"] != "active":
            raise ApiError(409, "project_not_active", "Only an active project can have sessions.")
        sid = gen_id("sess")
        cursor.execute(
            "INSERT INTO sessions (id, imager_id, project_id, state, previous_state, observing_date, started_at, logged_at, notes, created_at)"
            " VALUES (%s,%s,%s,%s,NULL,%s,NULL,NULL,%s,%s)",
            (sid, ident, project_id, "planned", observing, notes, now_utc()),
        )
        return session_body(cursor, dict(cursor.execute("SELECT * FROM sessions WHERE id=%s", (sid,)).fetchone()))
    return JSONResponse(db().run_in_transaction(fn), status_code=201)


def _is_date(value: str) -> bool:
    try:
        datetime.strptime(value, "%Y-%m-%d")
        return True
    except ValueError:
        return False


async def get_session(request: Request):
    ident = imager(request)
    sid = request.path_params["session_id"]

    def fn(cursor):
        row = _session_of(cursor, sid, ident)
        return session_body(cursor, row)
    return JSONResponse(db().run_in_transaction(fn))


async def start_session(request: Request):
    ident = imager(request)
    sid = request.path_params["session_id"]
    body = await read_json(request)
    from darkframe.services.ledger.sites import zone_from_header

    zone = zone_from_header(request)
    raw = body.get("started_at")

    def fn(cursor):
        row = _session_of(cursor, sid, ident)
        project = _project_of(cursor, row["project_id"], ident)
        if row["state"] != "planned":
            raise ApiError(409, "illegal_transition", f"A session that is {row['state']} cannot become imaging.")
        if project["state"] != "active":
            raise ApiError(409, "project_not_active", "Only an active project can have sessions.")
        if raw in (None, ""):
            started = now_utc()
        else:
            started = _parse_started_at(raw, zone)
        cursor.execute(
            "UPDATE sessions SET state='imaging', started_at=%s, observing_date=%s WHERE id=%s",
            (started, _observing_date_of(started, zone), sid),
        )
        return session_body(cursor, dict(cursor.execute("SELECT * FROM sessions WHERE id=%s", (sid,)).fetchone()))
    return JSONResponse(db().run_in_transaction(fn))


async def log_session(request: Request):
    ident = imager(request)
    sid = request.path_params["session_id"]
    await read_json(request)

    def fn(cursor):
        row = _session_of(cursor, sid, ident)
        if row["state"] != "imaging":
            raise ApiError(409, "illegal_transition", f"A session that is {row['state']} cannot become logged.")
        batches = cursor.execute("SELECT * FROM batches WHERE session_id=%s", (sid,)).fetchall()
        if not batches:
            raise ApiError(409, "no_batches", "Log at least one batch before finishing the session.")
        for b in batches:
            _post_movement(cursor, "log", row["project_id"], ident, b["filter"], _integration(dict(b)), sid, b["id"])
        cursor.execute("UPDATE sessions SET state='logged', logged_at=%s WHERE id=%s", (now_utc(), sid))
        return session_body(cursor, dict(cursor.execute("SELECT * FROM sessions WHERE id=%s", (sid,)).fetchone()))
    return JSONResponse(db().run_in_transaction(fn))


async def amend_session(request: Request):
    ident = imager(request)
    sid = request.path_params["session_id"]
    body = await read_json(request)

    def fn(cursor):
        row = _session_of(cursor, sid, ident)
        if row["state"] not in ("logged", "amended"):
            raise ApiError(409, "illegal_transition", f"A session that is {row['state']} cannot become amended.")
        incoming = body.get("batches")
        if not isinstance(incoming, list) or not incoming:
            raise ApiError(422, "validation", "Send at least one batch.", {"batches": "Send at least one batch."})
        current = {b["id"]: dict(b) for b in cursor.execute("SELECT * FROM batches WHERE session_id=%s", (sid,)).fetchall()}
        allowed = _planned_filters(cursor, row["project_id"])
        validated = []
        for i, item in enumerate(incoming):
            if not isinstance(item, dict):
                raise ApiError(422, "validation", "Each batch must be an object.", {f"batches[{i}]": "Each batch must be an object."})
            bid = item.get("id")
            if bid is not None and bid not in current:
                raise ApiError(404, "not_found", "There is no such batch in this session.")
            prefix = f"batches[{i}]."
            validated.append((bid, _validate_batch_fields(item, allowed, prefix), item))
        removed = [b for bid, b in current.items() if bid not in {v[0] for v in validated}]
        frames_by_batch = {
            r["batch_id"]: r["n"]
            for r in cursor.execute(
                "SELECT batch_id, COUNT(*) AS n FROM frames WHERE batch_id = ANY(%s) GROUP BY batch_id",
                ([b["id"] for b in removed],),
            ).fetchall()
        } if removed else {}
        for b in removed:
            if frames_by_batch.get(b["id"], 0) > 0:
                raise ApiError(409, "batch_has_frames", "A batch with frames cannot be removed.")
        # Post reversals for removed batches.
        for b in removed:
            movement = _latest_unreversed_log(cursor, b["id"])
            if movement:
                _post_movement(cursor, "reversal", row["project_id"], ident, b["filter"], movement["seconds"], sid, b["id"], reverses=movement["movement_id"])
            cursor.execute("DELETE FROM calibration_links WHERE batch_id=%s", (b["id"],))
            cursor.execute("DELETE FROM batches WHERE id=%s", (b["id"],))
        next_idx = 1
        for bid, values, _raw in validated:
            if bid:
                existing = current[bid]
                changed = any(existing[k] != values[k] for k in values)
                if changed:
                    movement = _latest_unreversed_log(cursor, bid)
                    if movement:
                        _post_movement(cursor, "reversal", row["project_id"], ident, existing["filter"], movement["seconds"], sid, bid, reverses=movement["movement_id"])
                    _post_movement(cursor, "log", row["project_id"], ident, values["filter"], _integration(values), sid, bid)
                    cursor.execute(
                        "UPDATE batches SET filter=%s, sub_count=%s, exposure_s=%s, camera=%s, gain=%s, \"offset\"=%s, temperature_c=%s, binning=%s WHERE id=%s",
                        (values["filter"], values["sub_count"], values["exposure_s"], values["camera"], values["gain"], values["offset"], values["temperature_c"], values["binning"], bid),
                    )
                    _drop_stale_calibration(cursor, bid)
            else:
                new_id = gen_id("batch")
                _post_movement(cursor, "log", row["project_id"], ident, values["filter"], _integration(values), sid, new_id)
                cursor.execute(
                    "INSERT INTO batches (id, imager_id, session_id, idx, filter, sub_count, exposure_s, camera, gain, \"offset\", temperature_c, binning, created_at)"
                    " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                    (new_id, ident, sid, 0, values["filter"], values["sub_count"], values["exposure_s"], values["camera"], values["gain"], values["offset"], values["temperature_c"], values["binning"], now_utc()),
                )
                next_idx += 1
        _reindex(cursor, sid)
        cursor.execute("UPDATE sessions SET state='amended' WHERE id=%s", (sid,))
        return session_body(cursor, dict(cursor.execute("SELECT * FROM sessions WHERE id=%s", (sid,)).fetchone()))
    return JSONResponse(db().run_in_transaction(fn))


def _reindex(cursor, session_id: str) -> None:
    rows = cursor.execute("SELECT id FROM batches WHERE session_id=%s ORDER BY created_at, id", (session_id,)).fetchall()
    for idx, r in enumerate(rows, start=1):
        cursor.execute("UPDATE batches SET idx=%s WHERE id=%s", (idx, r["id"]))


def _drop_stale_calibration(cursor, batch_id: str) -> None:
    """Drop any calibration link that no longer matches the batch (Business rules)."""
    from darkframe.services.ledger.calibration import set_mismatches

    batch = dict(cursor.execute("SELECT * FROM batches WHERE id=%s", (batch_id,)).fetchone())
    for link in cursor.execute("SELECT * FROM calibration_links WHERE batch_id=%s", (batch_id,)).fetchall():
        row = cursor.execute("SELECT * FROM calibration_sets WHERE id=%s", (link["calibration_set_id"],)).fetchone()
        if not row:
            cursor.execute("DELETE FROM calibration_links WHERE batch_id=%s AND kind=%s", (batch_id, link["kind"]))
            continue
        mismatches = set_mismatches(dict(row), batch)
        if mismatches:
            cursor.execute("DELETE FROM calibration_links WHERE batch_id=%s AND kind=%s", (batch_id, link["kind"]))


async def trash_session(request: Request):
    ident = imager(request)
    sid = request.path_params["session_id"]

    def fn(cursor):
        row = _session_of(cursor, sid, ident)
        if row["state"] not in ("planned", "logged", "amended"):
            raise ApiError(409, "illegal_transition", f"A session that is {row['state']} cannot become trashed.")
        for b in cursor.execute("SELECT * FROM batches WHERE session_id=%s", (sid,)).fetchall():
            movement = _latest_unreversed_log(cursor, b["id"])
            if movement:
                _post_movement(cursor, "reversal", row["project_id"], ident, b["filter"], movement["seconds"], sid, b["id"], reverses=movement["movement_id"])
        cursor.execute("UPDATE sessions SET previous_state=state, state='trashed' WHERE id=%s", (sid,))
        return session_body(cursor, dict(cursor.execute("SELECT * FROM sessions WHERE id=%s", (sid,)).fetchone()))
    return JSONResponse(db().run_in_transaction(fn))


async def restore_session(request: Request):
    ident = imager(request)
    sid = request.path_params["session_id"]

    def fn(cursor):
        row = _session_of(cursor, sid, ident)
        if row["state"] != "trashed":
            raise ApiError(409, "illegal_transition", f"A session that is {row['state']} cannot become {row['previous_state']}.")
        target = row["previous_state"] or "planned"
        if target in ("logged", "amended"):
            for b in cursor.execute("SELECT * FROM batches WHERE session_id=%s", (sid,)).fetchall():
                _post_movement(cursor, "log", row["project_id"], ident, b["filter"], _integration(dict(b)), sid, b["id"])
        cursor.execute("UPDATE sessions SET state=%s WHERE id=%s", (target, sid))
        return session_body(cursor, dict(cursor.execute("SELECT * FROM sessions WHERE id=%s", (sid,)).fetchone()))
    return JSONResponse(db().run_in_transaction(fn))
