"""Safe retries: one stored answer per organization, route and key."""
import datetime
import hashlib
import json

from . import db, textutil, validate
from .errors import TesselError, validation_error

RETENTION = datetime.timedelta(hours=24)


def read_header(request):
    raw = request.header("Idempotency-Key")
    if raw is None:
        return None
    if not validate.IDEMPOTENCY_KEY.match(raw):
        raise validation_error(
            "Idempotency-Key",
            "Write 1 to 64 letters, digits, underscores or hyphens",
        )
    return raw


def digest_of(body):
    canonical = json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def claim(organization_id, route, key, digest):
    """Take the key, or answer the stored reply, a reuse or a race."""
    with db.tx() as cur:
        cur.execute(
            "DELETE FROM idempotency_records WHERE created_at < %s",
            (textutil.now() - RETENTION,),
        )
        cur.execute(
            """
            INSERT INTO idempotency_records
                   (organization_id, route, key, request_digest, state, created_at)
            VALUES (%s, %s, %s, %s, 'in_progress', %s)
            ON CONFLICT (organization_id, route, key) DO NOTHING
            """,
            (organization_id, route, key, digest, textutil.now()),
        )
        if cur.rowcount == 1:
            return None
        row = cur.one(
            """
            SELECT request_digest, state, status, data FROM idempotency_records
             WHERE organization_id = %s AND route = %s AND key = %s
            """,
            (organization_id, route, key),
        )
    if row is None:
        raise TesselError("IDEMPOTENCY_IN_PROGRESS")
    if row["request_digest"] != digest:
        raise TesselError("IDEMPOTENCY_KEY_REUSED")
    if row["state"] != "done":
        raise TesselError("IDEMPOTENCY_IN_PROGRESS")
    return row["status"], json.loads(row["data"])


def finish(organization_id, route, key, status, data, database_id=None):
    with db.tx() as cur:
        cur.execute(
            """
            UPDATE idempotency_records
               SET state = 'done', status = %s, data = %s, database_id = %s
             WHERE organization_id = %s AND route = %s AND key = %s
            """,
            (
                status,
                json.dumps(data, ensure_ascii=False),
                database_id,
                organization_id,
                route,
                key,
            ),
        )


def abandon(organization_id, route, key):
    with db.tx() as cur:
        cur.execute(
            """
            DELETE FROM idempotency_records
             WHERE organization_id = %s AND route = %s AND key = %s AND state = 'in_progress'
            """,
            (organization_id, route, key),
        )
