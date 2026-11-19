"""Ledger route handlers: projects, allotments, transitions, ledger, sharing."""
from __future__ import annotations

from typing import Any, Optional

from starlette.requests import Request
from starlette.responses import JSONResponse

from darkframe.common.http import ApiError, gen_id, gen_token, read_json
from darkframe.common.validate import FILTERS
from darkframe.services.ledger.api import (
    _post_movement, _project_of, project_body, db, now_utc,
)


def imager(request: Request) -> str:
    return request.headers.get("x-imager-id", "")


def _transition_ok(state: str, to: str, cursor, project: dict) -> Optional[str]:
    """The project state machine; returns the guard error code or None."""
    edges = {
        "draft": {"active", "archived"},
        "active": {"paused", "complete"},
        "paused": {"active"},
        "complete": {"archived"},
    }
    if to not in edges.get(state, set()):
        return "illegal_transition"
    if to == "active" and state == "draft":
        if not _has_allotment(cursor, project["id"]):
            return "no_allotments"
    if to == "complete":
        owed = cursor.execute(
            "SELECT COALESCE(SUM(seconds) FILTER (WHERE account='owed'),0) AS owed FROM entries WHERE project_id=%s",
            (project["id"],),
        ).fetchone()["owed"]
        if int(owed) > 0:
            return "hours_still_owed"
    return None


def _has_allotment(cursor, project_id: str) -> bool:
    row = cursor.execute(
        "SELECT 1 FROM entries WHERE project_id=%s AND account='allotment' AND seconds <> 0 LIMIT 1",
        (project_id,),
    ).fetchone()
    return bool(row)


async def list_projects(request: Request):
    ident = imager(request)
    def fn(cursor):
        rows = cursor.execute("SELECT * FROM projects WHERE imager_id=%s ORDER BY name", (ident,)).fetchall()
        return {"projects": [project_body(cursor, dict(r)) for r in rows]}
    return JSONResponse(db().run_in_transaction(fn))


async def create_project(request: Request):
    ident = imager(request)
    body = await read_json(request)
    name = body.get("name")
    target = body.get("target_name")
    ra = body.get("ra_deg")
    dec = body.get("dec_deg")
    fields: dict[str, str] = {}
    if not isinstance(name, str) or not 1 <= len(name) <= 80:
        fields["name"] = "Project name must be between 1 and 80 characters."
    if not isinstance(target, str) or not 1 <= len(target) <= 80:
        fields["target_name"] = "Target name must be between 1 and 80 characters."
    if isinstance(ra, bool) or not isinstance(ra, (int, float)) or not (0 <= ra < 360):
        fields["ra_deg"] = "Right ascension must be from 0 up to 360 degrees."
    if isinstance(dec, bool) or not isinstance(dec, (int, float)) or not (-90 <= dec <= 90):
        fields["dec_deg"] = "Declination must be between -90 and 90 degrees."
    if fields:
        raise ApiError(422, "validation", "Check the highlighted fields.", fields)

    def fn(cursor):
        pid = gen_id("proj")
        cursor.execute(
            "INSERT INTO projects (id, imager_id, name, target_name, ra_deg, dec_deg, state, created_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
            (pid, ident, name, target, float(ra), float(dec), "draft", now_utc()),
        )
        row = _project_of(cursor, pid, ident)
        return project_body(cursor, row)
    return JSONResponse(db().run_in_transaction(fn), status_code=201)


async def get_project(request: Request):
    ident = imager(request)
    pid = request.path_params["project_id"]

    def fn(cursor):
        row = _project_of(cursor, pid, ident)
        return project_body(cursor, row)
    return JSONResponse(db().run_in_transaction(fn))


async def patch_project(request: Request):
    ident = imager(request)
    pid = request.path_params["project_id"]
    body = await read_json(request)
    fields: dict[str, str] = {}
    updates: dict[str, Any] = {}
    if "name" in body:
        if not isinstance(body["name"], str) or not 1 <= len(body["name"]) <= 80:
            fields["name"] = "Project name must be between 1 and 80 characters."
        else:
            updates["name"] = body["name"]
    if "target_name" in body:
        if not isinstance(body["target_name"], str) or not 1 <= len(body["target_name"]) <= 80:
            fields["target_name"] = "Target name must be between 1 and 80 characters."
        else:
            updates["target_name"] = body["target_name"]
    if "ra_deg" in body:
        v = body["ra_deg"]
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not (0 <= v < 360):
            fields["ra_deg"] = "Right ascension must be from 0 up to 360 degrees."
        else:
            updates["ra_deg"] = float(v)
    if "dec_deg" in body:
        v = body["dec_deg"]
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not (-90 <= v <= 90):
            fields["dec_deg"] = "Declination must be between -90 and 90 degrees."
        else:
            updates["dec_deg"] = float(v)
    if fields:
        raise ApiError(422, "validation", "Check the highlighted fields.", fields)

    def fn(cursor):
        row = _project_of(cursor, pid, ident)
        if row["state"] in ("complete", "archived"):
            raise ApiError(409, "project_closed", "This project is closed to edits.")
        for key, value in updates.items():
            cursor.execute(f"UPDATE projects SET {key}=%s WHERE id=%s", (value, pid))
        row = _project_of(cursor, pid, ident)
        return project_body(cursor, row)
    return JSONResponse(db().run_in_transaction(fn))


async def transition_project(request: Request):
    ident = imager(request)
    pid = request.path_params["project_id"]
    body = await read_json(request)
    to = body.get("to")
    if to not in ("active", "paused", "complete", "archived"):
        raise ApiError(422, "validation", "That is not a project state.", {"to": "That is not a project state."})

    def fn(cursor):
        row = _project_of(cursor, pid, ident)
        problem = _transition_ok(row["state"], to, cursor, row)
        if problem == "illegal_transition":
            raise ApiError(409, "illegal_transition", f"A project that is {row['state']} cannot become {to}.")
        if problem == "no_allotments":
            raise ApiError(409, "no_allotments", "Give the project planned time on at least one filter first.")
        if problem == "hours_still_owed":
            raise ApiError(409, "hours_still_owed", "This project still owes hours on some filters.")
        cursor.execute("UPDATE projects SET state=%s WHERE id=%s", (to, pid))
        return project_body(cursor, _project_of(cursor, pid, ident))
    return JSONResponse(db().run_in_transaction(fn))


async def put_allotment(request: Request):
    ident = imager(request)
    pid = request.path_params["project_id"]
    filt = request.path_params["filter"]
    body = await read_json(request)
    if filt not in FILTERS:
        raise ApiError(422, "validation", "That is not a filter.", {"filter": "That is not a filter."})
    planned = body.get("planned_seconds")
    if (
        isinstance(planned, bool) or not isinstance(planned, int)
        or not (0 <= planned <= 3_600_000) or planned % 60 != 0
    ):
        raise ApiError(422, "validation", "Planned seconds must be a whole number of minutes up to 3,600,000.", {"planned_seconds": "Planned seconds must be a whole number of minutes up to 3,600,000."})

    def fn(cursor):
        row = _project_of(cursor, pid, ident)
        if row["state"] in ("complete", "archived"):
            raise ApiError(409, "project_closed", "This project is closed to edits.")
        current = cursor.execute(
            "SELECT COALESCE(-SUM(seconds) FILTER (WHERE account='allotment'),0) AS planned FROM entries WHERE project_id=%s AND filter=%s",
            (pid, filt),
        ).fetchone()["planned"]
        if int(current) != planned:
            _post_movement(cursor, "allot", pid, ident, filt, planned - int(current), None, None)
        return project_body(cursor, _project_of(cursor, pid, ident))
    return JSONResponse(db().run_in_transaction(fn))


async def get_ledger(request: Request):
    ident = imager(request)
    pid = request.path_params["project_id"]

    def fn(cursor):
        _project_of(cursor, pid, ident)
        rows = cursor.execute(
            "SELECT * FROM entries WHERE project_id=%s ORDER BY created_at, id", (pid,)
        ).fetchall()
        entries = []
        for r in rows:
            entries.append({
                "id": r["id"],
                "movement_id": r["movement_id"],
                "movement_kind": r["movement_kind"],
                "filter": r["filter"],
                "account": r["account"],
                "seconds": int(r["seconds"]),
                "session_id": r["session_id"],
                "batch_id": r["batch_id"],
                "reverses_movement_id": r["reverses_movement_id"],
                "created_at": r["created_at"].isoformat().replace("+00:00", "Z"),
            })
        return {"entries": entries}
    return JSONResponse(db().run_in_transaction(fn))


# ---------------------------------------------------------------------------
# Sharing


def _share_body(row: dict) -> dict:
    return {
        "token": row["token"],
        "url": f"/s/{row['token']}",
        "expires_at": row["expires_at"].isoformat().replace("+00:00", "Z") if row["expires_at"] else None,
    }


async def create_share(request: Request):
    ident = imager(request)
    pid = request.path_params["project_id"]
    body = await read_json(request)
    expires_at = body.get("expires_at")
    if expires_at is not None:
        if not isinstance(expires_at, str):
            raise ApiError(422, "validation", "Link expiry must be a UTC timestamp.", {"expires_at": "Link expiry must be a UTC timestamp."})
        try:
            parsed = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
        except ValueError:
            raise ApiError(422, "validation", "Link expiry must be a UTC timestamp.", {"expires_at": "Link expiry must be a UTC timestamp."})
        if parsed.tzinfo is None or parsed <= now_utc():
            raise ApiError(422, "validation", "Link expiry must be a timestamp in the future.", {"expires_at": "Link expiry must be a timestamp in the future."})
    else:
        parsed = None

    def fn(cursor):
        _project_of(cursor, pid, ident)
        cursor.execute("DELETE FROM share_links WHERE project_id=%s", (pid,))
        token = gen_token(43)
        cursor.execute(
            "INSERT INTO share_links (project_id, token, imager_id, expires_at, created_at) VALUES (%s,%s,%s,%s,%s)",
            (pid, token, ident, parsed, now_utc()),
        )
        row = cursor.execute("SELECT * FROM share_links WHERE project_id=%s", (pid,)).fetchone()
        return _share_body(dict(row))
    return JSONResponse(db().run_in_transaction(fn), status_code=201)


async def get_share(request: Request):
    ident = imager(request)
    pid = request.path_params["project_id"]

    def fn(cursor):
        _project_of(cursor, pid, ident)
        row = cursor.execute("SELECT * FROM share_links WHERE project_id=%s", (pid,)).fetchone()
        if not row or (row["expires_at"] and row["expires_at"] <= now_utc()):
            raise ApiError(404, "not_found", "There is no live link for this project.")
        return _share_body(dict(row))
    return JSONResponse(db().run_in_transaction(fn))


async def revoke_share(request: Request):
    ident = imager(request)
    pid = request.path_params["project_id"]

    def fn(cursor):
        _project_of(cursor, pid, ident)
        row = cursor.execute("SELECT * FROM share_links WHERE project_id=%s", (pid,)).fetchone()
        if not row:
            raise ApiError(404, "not_found", "There is no live link for this project.")
        cursor.execute("DELETE FROM share_links WHERE project_id=%s", (pid,))
        return None
    db().run_in_transaction(fn)
    return JSONResponse({}, status_code=204)


async def shared_body(request: Request):
    token = request.path_params["token"]

    def fn(cursor):
        row = cursor.execute("SELECT * FROM share_links WHERE token=%s", (token,)).fetchone()
        if not row or (row["expires_at"] and row["expires_at"] <= now_utc()):
            raise ApiError(404, "not_found", "This shared project link is no longer available.")
        project = _project_of(cursor, row["project_id"], row["imager_id"])
        body = project_body(cursor, project)
        lat = float(request.headers.get("x-site-latitude", "0"))
        lon = float(request.headers.get("x-site-longitude", "0"))
        return {
            "project_name": body["name"],
            "target_name": body["target_name"],
            "state": body["state"],
            "filters": body["filters"],
            "total_integration_seconds": body["total_integration_seconds"],
            "session_count": body["session_count"],
            "site": {"latitude": lat, "longitude": lon},
        }
    return JSONResponse(db().run_in_transaction(fn))
