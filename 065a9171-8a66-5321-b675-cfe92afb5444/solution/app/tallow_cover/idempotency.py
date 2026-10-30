"""The one Idempotency-Key rule shared by punches and cover claims (brief: Idempotency keys).

A keyed request runs inside one transaction that first takes a lock on (caller, key), so a
concurrent twin waits for it: after a success the twin replays the stored bytes, after a refusal
(nothing stored, the transaction rolled back) it is judged afresh.
"""

import hashlib
import json

import asyncpg
from starlette.responses import JSONResponse, Response

from .config import settings
from .errors import ApiError, Fields
from .web import Call

KEY_MSG = "Send an Idempotency-Key of 1 to 100 characters."
KEY_MAX = 100


def key_of(call: Call) -> str | None:
    key = call.header("idempotency-key")
    return key if key is not None and 1 <= len(key) <= KEY_MAX else None


def check_key(call: Call, fields: Fields) -> None:
    if key_of(call) is None:
        fields.fail("Idempotency-Key", KEY_MSG)


def _fingerprint(call: Call) -> str:
    """A keyed request is its method, path and JSON body."""
    request = [call.request.method, call.request.url.path, call.body]
    return hashlib.sha256(json.dumps(request, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


async def replay(conn: asyncpg.Connection, call: Call) -> Response | None:
    """Wait for any twin with the same caller and key; then the stored success, or None to run the action."""
    key = key_of(call)
    if key is None:
        return None
    person_id = call.me["id"]
    await conn.execute("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", f"{person_id}\n{key}")
    await conn.execute("DELETE FROM idempotency_keys WHERE person_id = $1 AND key = $2"
                       " AND created_at <= now() - make_interval(secs => $3)",
                       person_id, key, settings.idempotency_ttl_seconds)
    stored = await conn.fetchrow("SELECT * FROM idempotency_keys WHERE person_id = $1 AND key = $2", person_id, key)
    if stored is None:
        return None
    if stored["request_hash"] != _fingerprint(call):
        raise ApiError("idempotency_key_reused")
    return Response(stored["body"], stored["status"], media_type="application/json",
                    headers={"Cache-Control": "no-store", "Idempotent-Replayed": "true"})


async def remember(conn: asyncpg.Connection, call: Call, payload: dict, status: int) -> Response:
    """Record the first success for the key and answer with exactly the bytes a replay will return."""
    body = JSONResponse(payload).body.decode()
    await conn.execute("INSERT INTO idempotency_keys (person_id, key, request_hash, status, body)"
                       " VALUES ($1, $2, $3, $4, $5)", call.me["id"], key_of(call), _fingerprint(call), status, body)
    return Response(body, status, media_type="application/json", headers={"Cache-Control": "no-store"})
