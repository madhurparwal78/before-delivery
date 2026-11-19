"""The ledger's HTTP API helpers: shared lookups, ledger movements, record bodies."""
from __future__ import annotations

import secrets
from datetime import datetime, timezone
from typing import Any, Optional


from darkframe.common.db import Database
from darkframe.common.http import ApiError, gen_id
from darkframe.common.validate import FILTERS

VERSION = "1.0.0"
DB: Optional[Database] = None
STORAGE: Any = None


def db() -> Database:
    assert DB is not None
    return DB


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _project_of(cursor, project_id: str, imager_id: str) -> dict:
    row = cursor.execute("SELECT * FROM projects WHERE id = %s", (project_id,)).fetchone()
    if not row:
        raise ApiError(404, "not_found", "There is no project with that id.")
    if row["imager_id"] != imager_id:
        raise ApiError(404, "not_found", "There is no project with that id.")
    return dict(row)


def _session_of(cursor, session_id: str, imager_id: str) -> dict:
    row = cursor.execute("SELECT * FROM sessions WHERE id = %s", (session_id,)).fetchone()
    if not row or row["imager_id"] != imager_id:
        raise ApiError(404, "not_found", "There is no session with that id.")
    return dict(row)


def _batch_of(cursor, batch_id: str, imager_id: str) -> dict:
    row = cursor.execute("SELECT b.* FROM batches b JOIN sessions s ON s.id = b.session_id WHERE b.id = %s AND s.imager_id = %s", (batch_id, imager_id)).fetchone()
    if not row:
        raise ApiError(404, "not_found", "There is no batch with that id.")
    return dict(row)


def _set_of(cursor, set_id: str, imager_id: str) -> dict:
    row = cursor.execute("SELECT * FROM calibration_sets WHERE id = %s", (set_id,)).fetchone()
    if not row or row["imager_id"] != imager_id:
        raise ApiError(404, "not_found", "There is no calibration set with that id.")
    return dict(row)


# ---------------------------------------------------------------------------
# Ledger movements


def _post_movement(cursor, kind: str, project_id: str, imager_id: str, filt: str,
                    seconds: int, session_id: Optional[str], batch_id: Optional[str],
                    reverses: Optional[str] = None, at: Optional[datetime] = None) -> str:
    """A movement writes its owed entry and the cancelling partner entry.

    Log: owed -E, integrated +E. Allot: owed +(Q-P), allotment -(Q-P).
    A reversal posts the exact negation of the movement it reverses.
    """
    movement_id = "mov_" + secrets.token_hex(10)
    stamp = at or now_utc()
    partner = "allotment" if kind == "allot" else "integrated"
    owed_seconds = -seconds if kind == "log" else seconds
    cursor.execute(
        "INSERT INTO entries (id, movement_id, movement_kind, project_id, imager_id, filter, account, seconds, session_id, batch_id, reverses_movement_id, created_at)"
        " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s),(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        (
            gen_id("ent"), movement_id, kind, project_id, imager_id, filt, "owed", owed_seconds, session_id, batch_id, reverses, stamp,
            gen_id("ent"), movement_id, kind, project_id, imager_id, filt, partner, -owed_seconds, session_id, batch_id, reverses, stamp,
        ),
    )
    return movement_id


def _allotment(cursor, project_id: str, imager_id: str, filt: str) -> int:
    row = cursor.execute(
        "SELECT COALESCE(-SUM(seconds) FILTER (WHERE account='allotment'),0) AS planned FROM entries WHERE project_id=%s AND filter=%s",
        (project_id, filt),
    ).fetchone()
    return int(row["planned"])


def _logged_seconds(cursor, project_id: str, filt: Optional[str] = None) -> int:
    sql = "SELECT COALESCE(SUM(seconds) FILTER (WHERE account='integrated'),0) AS logged FROM entries WHERE project_id=%s"
    params: tuple = (project_id,)
    if filt:
        sql += " AND filter=%s"
        params = (project_id, filt)
    row = cursor.execute(sql, params).fetchone()
    return int(row["logged"])


def _latest_unreversed_log(cursor, batch_id: str) -> Optional[dict]:
    """The latest log movement's integration for a batch that nothing reverses."""
    row = cursor.execute(
        "SELECT e.movement_id, -e.seconds AS seconds FROM entries e WHERE e.batch_id=%s AND e.account='owed' AND e.movement_kind='log'"
        " AND NOT EXISTS (SELECT 1 FROM entries r WHERE r.reverses_movement_id=e.movement_id)"
        " ORDER BY e.created_at DESC, e.id DESC LIMIT 1",
        (batch_id,),
    ).fetchone()
    return dict(row) if row else None


def project_body(cursor, project: dict) -> dict:
    filters = cursor.execute(
        "SELECT filter, "
        " COALESCE(-SUM(seconds) FILTER (WHERE account='allotment'),0) AS planned,"
        " COALESCE(SUM(seconds) FILTER (WHERE account='integrated'),0) AS logged,"
        " COALESCE(SUM(seconds) FILTER (WHERE account='owed'),0) AS owed"
        " FROM entries WHERE project_id=%s GROUP BY filter",
        (project["id"],),
    ).fetchall()
    by_filter = {row["filter"]: dict(row) for row in filters}
    listed = [f for f in FILTERS if f in by_filter]
    filter_rows = [
        {
            "filter": f,
            "planned_seconds": int(by_filter[f]["planned"]),
            "logged_seconds": int(by_filter[f]["logged"]),
            "owed_seconds": int(by_filter[f]["owed"]),
        }
        for f in listed
    ]
    session_count = cursor.execute("SELECT COUNT(*) AS n FROM sessions WHERE project_id=%s AND state <> 'trashed'", (project["id"],)).fetchone()["n"]
    return {
        "id": project["id"],
        "name": project["name"],
        "target_name": project["target_name"],
        "ra_deg": project["ra_deg"],
        "dec_deg": project["dec_deg"],
        "state": project["state"],
        "filters": filter_rows,
        "total_integration_seconds": sum(f["logged_seconds"] for f in filter_rows),
        "session_count": int(session_count),
    }


def batch_body(cursor, batch: dict) -> dict:
    links = cursor.execute("SELECT kind, calibration_set_id FROM calibration_links WHERE batch_id=%s", (batch["id"],)).fetchall()
    cal = {row["kind"]: row["calibration_set_id"] for row in links}
    frames = cursor.execute("SELECT COUNT(*) AS n FROM frames WHERE batch_id=%s", (batch["id"],)).fetchone()["n"]
    return {
        "id": batch["id"],
        "filter": batch["filter"],
        "sub_count": batch["sub_count"],
        "exposure_s": batch["exposure_s"],
        "integration_seconds": batch["sub_count"] * batch["exposure_s"],
        "camera": batch["camera"],
        "gain": batch["gain"],
        "offset": batch["offset"],
        "temperature_c": batch["temperature_c"],
        "binning": batch["binning"],
        "calibration": {"dark": cal.get("dark"), "flat": cal.get("flat"), "bias": cal.get("bias")},
        "frame_count": int(frames),
    }


def frame_body(row: dict) -> dict:
    return {
        "id": row["id"],
        "batch_id": row["batch_id"],
        "name": row["name"],
        "size_bytes": int(row["size_bytes"]),
        "content_type": row["content_type"],
        "sha256": row["sha256"],
    }


def session_body(cursor, session: dict) -> dict:
    project = _project_of(cursor, session["project_id"], session["imager_id"])
    batches = cursor.execute("SELECT * FROM batches WHERE session_id=%s ORDER BY idx", (session["id"],)).fetchall()
    frames = cursor.execute("SELECT * FROM frames WHERE batch_id IN (SELECT id FROM batches WHERE session_id=%s) ORDER BY created_at, id", (session["id"],)).fetchall()
    frame_rows = [frame_body(dict(f)) for f in frames]
    return {
        "id": session["id"],
        "project_id": session["project_id"],
        "project_name": project["name"],
        "state": session["state"],
        "previous_state": session["previous_state"],
        "observing_date": session["observing_date"],
        "started_at": session["started_at"].isoformat().replace("+00:00", "Z") if session["started_at"] else None,
        "logged_at": session["logged_at"].isoformat().replace("+00:00", "Z") if session["logged_at"] else None,
        "notes": session["notes"] or "",
        "batches": [batch_body(cursor, dict(b)) for b in batches],
        "frames": frame_rows,
        "frame_count": len(frame_rows),
        "integration_seconds": sum(b["sub_count"] * b["exposure_s"] for b in batches),
    }


def set_body(cursor, row: dict, site_today: str) -> dict:
    fields = {
        "id": row["id"], "name": row["name"], "kind": row["kind"], "camera": row["camera"],
        "gain": row["gain"], "offset": row["offset"], "exposure_s": row["exposure_s"],
        "temperature_c": row["temperature_c"], "binning": row["binning"], "filter": row["filter"],
        "frame_count": row["frame_count"], "captured_on": row["captured_on"],
    }
    status = row["status"]
    age_days = _age_days(site_today, row["captured_on"])
    max_age = {"dark": 180, "flat": 30, "bias": 365}[row["kind"]]
    if status == "ready" and age_days > max_age:
        status = "stale"
    return {
        **fields,
        "status": status,
        "age_days": age_days,
        "max_age_days": max_age,
        "version": row["version"],
        "master": row["current_master"],
    }


def _age_days(site_today: str, captured_on: str) -> int:
    import datetime as dt

    a = dt.date.fromisoformat(site_today)
    b = dt.date.fromisoformat(captured_on)
    return (a - b).days
