"""Batch creation with idempotency: the ledger's idempotent submit endpoint."""
from __future__ import annotations

import hashlib
import json

from starlette.requests import Request
from starlette.responses import JSONResponse

from darkframe.common.http import ApiError, gen_id
from darkframe.services.ledger.api import batch_body, db, now_utc, session_body, _session_of
from darkframe.services.ledger.sessions import (
    _planned_filters, _validate_batch_fields, imager,
)

UPLOAD_LIMIT = 20_000_000


async def add_batch(request: Request):
    ident = imager(request)
    sid = request.path_params["session_id"]
    raw = await request.body()
    if len(raw) > 65536:
        raise ApiError(413, "too_large", "That request body is too large.")
    ctype = request.headers.get("content-type", "").split(";")[0].strip().lower()
    if ctype != "application/json":
        raise ApiError(415, "unsupported_media_type", "Send the body as application/json.")
    body = json.loads(raw) if raw else {}
    key = request.headers.get("idempotency-key", "")
    if not key or not (1 <= len(key) <= 100):
        raise ApiError(422, "validation", "Send an Idempotency-Key header.", {"Idempotency-Key": "Send an Idempotency-Key header."})
    digest = hashlib.sha256(raw).hexdigest()

    def fn(cursor):
        row = _session_of(cursor, sid, ident)
        if row["state"] != "imaging":
            raise ApiError(409, "wrong_state", "Batches can be added only while the session is imaging.")
        prior = cursor.execute(
            "SELECT * FROM idempotency WHERE imager_id=%s AND key=%s", (ident, key)
        ).fetchone()
        if prior:
            if prior["body_hash"] != digest:
                raise ApiError(409, "idempotency_conflict", "That Idempotency-Key was used with a different batch.")
            return prior["status"], prior["response"]
        allowed = _planned_filters(cursor, row["project_id"])
        values = _validate_batch_fields(body, allowed)
        batch_id = gen_id("batch")
        max_idx = cursor.execute("SELECT COALESCE(MAX(idx),0) AS m FROM batches WHERE session_id=%s", (sid,)).fetchone()["m"]
        cursor.execute(
            "INSERT INTO batches (id, imager_id, session_id, idx, filter, sub_count, exposure_s, camera, gain, \"offset\", temperature_c, binning, created_at)"
            " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (batch_id, ident, sid, int(max_idx) + 1, values["filter"], values["sub_count"], values["exposure_s"], values["camera"], values["gain"], values["offset"], values["temperature_c"], values["binning"], now_utc()),
        )
        session = session_body(cursor, dict(cursor.execute("SELECT * FROM sessions WHERE id=%s", (sid,)).fetchone()))
        payload = {"batch": batch_body(cursor, dict(cursor.execute("SELECT * FROM batches WHERE id=%s", (batch_id,)).fetchone())), "session": session}
        cursor.execute(
            "INSERT INTO idempotency (imager_id, key, body_hash, status, response, created_at) VALUES (%s,%s,%s,%s,%s,%s)",
            (ident, key, digest, 201, json.dumps(payload), now_utc()),
        )
        return 201, payload
    status, payload = db().run_in_transaction(fn)
    return JSONResponse(payload, status_code=status)
