"""Idempotency keys: one place decides replay, conflict and in-progress races."""
import hashlib
import json

from .api import fail
from .textutil import ApiError, IDEM_KEY_RE, verification_error

def check_key(ctx):
    """Validate the Idempotency-Key header. Returns the key or None."""
    key = ctx.request.headers.get("Idempotency-Key")
    if key is None:
        return None
    if not IDEM_KEY_RE.match(key):
        raise verification_error("Idempotency-Key")
    return key


def body_digest(body):
    return hashlib.sha256(json.dumps(body, sort_keys=True, ensure_ascii=False)
                          .encode("utf-8")).hexdigest()


def named_database(body):
    for field in ("database", "name"):
        v = body.get(field)
        if isinstance(v, str) and v:
            return v
    return None


async def resolve(ctx, route, key, body):
    """Return (replay_response, in_progress) before the handler runs.

    Races are decided inside PostgreSQL by the unique key of the record.
    """
    db = ctx.db
    org = ctx.actor["organization_id"]
    digest = body_digest(body)
    row = await db.fetchrow(
        "SELECT digest, status, data, in_progress FROM app.idempotency "
        "WHERE organization_id = $1 AND route = $2 AND key = $3", org, route, key)
    if row is not None:
        if row["in_progress"]:
            fail(409, "IDEMPOTENCY_IN_PROGRESS", "A request with this idempotency key is still running")
        if row["digest"] != digest:
            fail(422, "IDEMPOTENCY_KEY_REUSED",
                 "This idempotency key was used with a different request")
        return {"status": row["status"], "data": json.loads(row["data"])}
    # claim the key; a racing claim by the same body waits for the first answer
    try:
        await db.execute(
            "INSERT INTO app.idempotency (organization_id, route, key, digest, status, data, "
            "in_progress, database, created_at) "
            "VALUES ($1, $2, $3, $4, 0, 'null', true, $5, now())",
            org, route, key, digest, named_database(body))
    except Exception:
        row = await db.fetchrow(
            "SELECT digest, status, data, in_progress FROM app.idempotency "
            "WHERE organization_id = $1 AND route = $2 AND key = $3", org, route, key)
        if row and row["in_progress"]:
            fail(409, "IDEMPOTENCY_IN_PROGRESS",
                 "A request with this idempotency key is still running")
        if row and row["digest"] != digest:
            fail(422, "IDEMPOTENCY_KEY_REUSED",
                 "This idempotency key was used with a different request")
        if row:
            return {"status": row["status"], "data": json.loads(row["data"])}
        raise
    return None


async def record(ctx, route, key, body, status, data):
    db = ctx.db
    org = ctx.actor["organization_id"]
    await db.execute(
        "UPDATE app.idempotency SET status = $4, data = $5, in_progress = false "
        "WHERE organization_id = $1 AND route = $2 AND key = $3",
        org, route, key, status, json.dumps(data, ensure_ascii=False))


async def discard(ctx, route, key):
    """A refused first attempt records nothing."""
    db = ctx.db
    await db.execute(
        "DELETE FROM app.idempotency WHERE organization_id = $1 AND route = $2 AND key = $3 "
        "AND in_progress = true",
        ctx.actor["organization_id"], route, key)
