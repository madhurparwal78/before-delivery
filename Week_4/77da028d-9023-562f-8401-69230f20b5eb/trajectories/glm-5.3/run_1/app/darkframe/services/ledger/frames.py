"""Frame upload and download, the edit lock and notes."""
from __future__ import annotations

import secrets
from datetime import timedelta

from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from darkframe.common.http import ApiError, gen_id, read_json, env_int
from darkframe.common.validate import FRAME_CONTENT_TYPES, NAME_RE
from darkframe.services.ledger.api import db, frame_body, now_utc, session_body, _session_of
from darkframe.services.ledger.batches import UPLOAD_LIMIT
from darkframe.services.ledger.sessions import imager
from darkframe.services.ledger.storage import storage

FRAME_NAME_MAX = 120


async def upload_frame(request: Request):
    ident = imager(request)
    batch_id = request.path_params["batch_id"]
    name = request.path_params["name"]
    if not name or len(name) > FRAME_NAME_MAX or not NAME_RE.match(name):
        raise ApiError(422, "validation", "The frame name must be letters, digits, dots, underscores or hyphens.", {"name": "The frame name must be letters, digits, dots, underscores or hyphens."})
    body = await request.body()
    if not (1 <= len(body) <= UPLOAD_LIMIT):
        raise ApiError(413, "too_large", "Frames must be between 1 and 20,000,000 bytes.")
    ctype = request.headers.get("content-type", "").split(";")[0].strip().lower()
    if ctype not in FRAME_CONTENT_TYPES:
        raise ApiError(415, "unsupported_media_type", "Frames must be PNG, JPEG or FITS.")

    def fn(cursor):
        batch = cursor.execute("SELECT b.* FROM batches b JOIN sessions s ON s.id=b.session_id WHERE b.id=%s AND s.imager_id=%s", (batch_id, ident)).fetchone()
        if not batch:
            raise ApiError(404, "not_found", "There is no batch with that id.")
        session = _session_of(cursor, batch["session_id"], ident)
        if session["state"] in ("planned", "trashed"):
            raise ApiError(409, "wrong_state", "Frames cannot be added to a session in that state.")
        existing = cursor.execute("SELECT 1 FROM frames WHERE batch_id=%s AND name=%s", (batch_id, name)).fetchone()
        if existing:
            raise ApiError(409, "frame_exists", "A frame with that name already exists in this batch.")
        frame_id = gen_id("frame")
        key = f"frames/{ident}/{session['id']}/{batch_id}/{frame_id}/{name}"
        stored = storage().put(key, body, ctype)
        cursor.execute(
            "INSERT INTO frames (id, imager_id, batch_id, name, size_bytes, content_type, sha256, created_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
            (frame_id, ident, batch_id, name, stored["size_bytes"], ctype, stored["sha256"], now_utc()),
        )
        count = cursor.execute(
            "SELECT COUNT(*) AS n FROM frames WHERE batch_id IN (SELECT id FROM batches WHERE session_id=%s)",
            (session["id"],),
        ).fetchone()["n"]
        return {
            "frame": frame_body(dict(cursor.execute("SELECT * FROM frames WHERE id=%s", (frame_id,)).fetchone())),
            "session_frame_count": int(count),
        }
    return JSONResponse(db().run_in_transaction(fn), status_code=201)


async def download_frame(request: Request):
    ident = imager(request)
    frame_id = request.path_params["frame_id"]

    def fn(cursor):
        row = cursor.execute("SELECT f.* FROM frames f JOIN batches b ON b.id=f.batch_id JOIN sessions s ON s.id=b.session_id WHERE f.id=%s AND s.imager_id=%s", (frame_id, ident)).fetchone()
        if not row:
            raise ApiError(404, "not_found", "There is no frame with that id.")
        session = cursor.execute("SELECT id FROM sessions WHERE id=%s", (row["batch_id"],)).fetchone()
        batch = cursor.execute("SELECT session_id FROM batches WHERE id=%s", (row["batch_id"],)).fetchone()
        return f"frames/{ident}/{batch['session_id']}/{row['batch_id']}/{row['id']}/{row['name']}"
    key = db().run_in_transaction(fn)
    data, ctype = storage().get(key)
    return Response(data, media_type=ctype)


# ---------------------------------------------------------------------------
# Edit lock


def _lock_seconds() -> int:
    return env_int("DRAFT_LOCK_SECONDS", 900)


async def take_lock(request: Request):
    ident = imager(request)
    sid = request.path_params["session_id"]
    body = await read_json(request)
    token = body.get("lock_token")

    def fn(cursor):
        row = _session_of(cursor, sid, ident)
        if row["state"] == "trashed":
            raise ApiError(409, "wrong_state", "A trashed session cannot be edited.")
        existing = cursor.execute("SELECT * FROM locks WHERE session_id=%s", (sid,)).fetchone()
        now = now_utc()
        if existing and existing["expires_at"] > now:
            if token != existing["lock_token"]:
                raise ApiError(409, "session_locked", "This session is open for editing on another device.")
            expires = existing["expires_at"]
        else:
            new_token = token or secrets.token_hex(16)
            expires = now + timedelta(seconds=_lock_seconds())
            cursor.execute(
                "INSERT INTO locks (session_id, lock_token, expires_at) VALUES (%s,%s,%s)"
                " ON CONFLICT (session_id) DO UPDATE SET lock_token=EXCLUDED.lock_token, expires_at=EXCLUDED.expires_at",
                (sid, new_token, expires),
            )
            token = new_token
        return {
            "lock_token": token,
            "expires_at": expires.isoformat().replace("+00:00", "Z"),
            "expires_in_seconds": int((expires - now).total_seconds()),
        }
    return JSONResponse(db().run_in_transaction(fn))


async def release_lock(request: Request):
    ident = imager(request)
    sid = request.path_params["session_id"]
    body = await read_json(request)
    token = body.get("lock_token")

    def fn(cursor):
        _session_of(cursor, sid, ident)
        existing = cursor.execute("SELECT * FROM locks WHERE session_id=%s", (sid,)).fetchone()
        if existing and token != existing["lock_token"]:
            raise ApiError(409, "session_locked", "This session is open for editing on another device.")
        if existing:
            cursor.execute("DELETE FROM locks WHERE session_id=%s", (sid,))
        return None
    db().run_in_transaction(fn)
    return JSONResponse({}, status_code=204)


async def save_notes(request: Request):
    ident = imager(request)
    sid = request.path_params["session_id"]
    body = await read_json(request)
    notes = body.get("notes")
    token = body.get("lock_token")
    if not isinstance(notes, str) or len(notes) > 10_000:
        raise ApiError(422, "validation", "Notes must be at most 10,000 characters.", {"notes": "Notes must be at most 10,000 characters."})

    def fn(cursor):
        row = _session_of(cursor, sid, ident)
        if row["state"] == "trashed":
            raise ApiError(409, "wrong_state", "A trashed session cannot be edited.")
        existing = cursor.execute("SELECT * FROM locks WHERE session_id=%s", (sid,)).fetchone()
        now = now_utc()
        if not existing or not token:
            raise ApiError(409, "lock_expired", "Your edit lock expired. Take it again to save.")
        if existing["expires_at"] <= now:
            if token == existing["lock_token"]:
                raise ApiError(409, "lock_expired", "Your edit lock expired. Take it again to save.")
            raise ApiError(409, "session_locked", "This session is open for editing on another device.")
        if token != existing["lock_token"]:
            raise ApiError(409, "session_locked", "This session is open for editing on another device.")
        cursor.execute("UPDATE sessions SET notes=%s WHERE id=%s", (notes, sid))
        return session_body(cursor, dict(cursor.execute("SELECT * FROM sessions WHERE id=%s", (sid,)).fetchone()))
    return JSONResponse(db().run_in_transaction(fn))
