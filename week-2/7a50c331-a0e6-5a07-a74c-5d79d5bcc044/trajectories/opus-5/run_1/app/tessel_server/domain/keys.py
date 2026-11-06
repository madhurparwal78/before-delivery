"""API keys: creation, scope, rotation, revocation and the per-key query limit."""
import datetime

from .. import audit, auth, textutil
from ..errors import TesselError, validation_error

KEY_ROLES = ("editor", "viewer")
MAX_SCOPE = 20
QUERY_LIMIT = {"ship": 20, "scale": 200}
QUERY_WINDOW = datetime.timedelta(seconds=60)


def listing(cur, organization_id):
    return [
        {
            "id": str(row["id"]),
            "name": row["name"],
            "role": row["role"],
            "prefix": row["prefix"],
            "created_at": textutil.format_timestamp(row["created_at"]),
            "revoked_at": textutil.format_timestamp(row["revoked_at"]),
        }
        for row in cur.all(
            """
            SELECT id, name, role, prefix, created_at, revoked_at FROM api_keys
             WHERE organization_id = %s ORDER BY created_at, id
            """,
            (organization_id,),
        )
    ]


def resolve_scope(cur, organization_id, names):
    """Turn requested database names into ids, refusing unknown or repeated ones."""
    if names is None:
        return None
    if len(names) < 1 or len(names) > MAX_SCOPE:
        raise validation_error(
            "databases", "Name between 1 and %d databases" % MAX_SCOPE
        )
    seen = set()
    identifiers = []
    for index, name in enumerate(names):
        path = "databases.%d" % index
        if not isinstance(name, str):
            raise validation_error(path, "This field must be a string")
        if name in seen:
            raise validation_error(path, "This database name is repeated")
        seen.add(name)
        found = cur.value(
            "SELECT id FROM databases WHERE organization_id = %s AND name = %s",
            (organization_id, name),
        )
        if found is None:
            raise validation_error(path, "This database does not exist")
        identifiers.append(found)
    return identifiers


def create(cur, actor, name, role, scope_ids):
    secret = auth.new_key_secret()
    row = cur.one(
        """
        INSERT INTO api_keys (organization_id, name, role, prefix, secret_digest,
                              scope_all, created_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        RETURNING id, name, role, prefix
        """,
        (
            actor.organization_id,
            name,
            role,
            secret[:12],
            auth.digest(secret),
            scope_ids is None,
            textutil.now(),
        ),
    )
    for database_id in scope_ids or ():
        cur.execute(
            "INSERT INTO api_key_databases (key_id, database_id) VALUES (%s, %s)",
            (row["id"], database_id),
        )
    audit.write(cur, actor.organization_id, actor.email, "key.create", name, role)
    return {
        "id": str(row["id"]),
        "name": row["name"],
        "role": row["role"],
        "prefix": row["prefix"],
        "secret": secret,
    }


def _find(cur, organization_id, key_id):
    if not str(key_id).isdigit():
        raise TesselError("KEY_NOT_FOUND")
    row = cur.one(
        """
        SELECT id, name, role, prefix, scope_all, created_at, last_used_at,
               rotated_at, revoked_at
          FROM api_keys WHERE id = %s AND organization_id = %s FOR UPDATE
        """,
        (int(key_id), organization_id),
    )
    if row is None:
        raise TesselError("KEY_NOT_FOUND")
    return row


def detail(cur, organization_id, key_id):
    row = _find(cur, organization_id, key_id)
    scope = None
    if not row["scope_all"]:
        scope = [
            item["name"]
            for item in cur.all(
                """
                SELECT d.name FROM api_key_databases k
                  JOIN databases d ON d.id = k.database_id
                 WHERE k.key_id = %s ORDER BY d.name
                """,
                (row["id"],),
            )
        ]
    return {
        "id": str(row["id"]),
        "name": row["name"],
        "role": row["role"],
        "prefix": row["prefix"],
        "databases": scope,
        "created_at": textutil.format_timestamp(row["created_at"]),
        "last_used_at": textutil.format_timestamp(row["last_used_at"]),
        "rotated_at": textutil.format_timestamp(row["rotated_at"]),
        "revoked_at": textutil.format_timestamp(row["revoked_at"]),
    }


def revoke(cur, actor, key_id):
    row = _find(cur, actor.organization_id, key_id)
    if row["revoked_at"] is not None:
        raise TesselError("KEY_REVOKED")
    cur.execute(
        "UPDATE api_keys SET revoked_at = %s WHERE id = %s",
        (textutil.now(), row["id"]),
    )
    audit.write(cur, actor.organization_id, actor.email, "key.revoke", row["name"])
    return row["name"]


def rotate(cur, actor, key_id):
    row = _find(cur, actor.organization_id, key_id)
    if row["revoked_at"] is not None:
        raise TesselError("KEY_REVOKED")
    secret = auth.new_key_secret()
    cur.execute(
        """
        UPDATE api_keys SET secret_digest = %s, prefix = %s, rotated_at = %s
         WHERE id = %s
        """,
        (auth.digest(secret), secret[:12], textutil.now(), row["id"]),
    )
    audit.write(cur, actor.organization_id, actor.email, "key.rotate", row["name"])
    return {
        "id": str(row["id"]),
        "prefix": secret[:12],
        "secret": secret,
    }, row["name"]


def query_allowance(cur, key_id, plan):
    """Count this query against the key's rolling window, or refuse it."""
    limit = QUERY_LIMIT[plan]
    since = textutil.now() - QUERY_WINDOW
    cur.execute("DELETE FROM key_query_hits WHERE at < %s", (since,))
    rows = cur.all(
        "SELECT at FROM key_query_hits WHERE key_id = %s AND at > %s ORDER BY at",
        (key_id, since),
    )
    if len(rows) >= limit:
        oldest = rows[-limit]["at"]
        remaining = (oldest + QUERY_WINDOW - textutil.now()).total_seconds()
        seconds = max(1, min(60, int(remaining) + 1))
        raise TesselError(
            "RATE_LIMITED",
            seconds=seconds,
            headers={
                "Retry-After": str(seconds),
                "RateLimit-Limit": str(limit),
                "RateLimit-Remaining": "0",
            },
        )
    cur.execute(
        "INSERT INTO key_query_hits (key_id, at) VALUES (%s, %s)",
        (key_id, textutil.now()),
    )
    return {
        "RateLimit-Limit": str(limit),
        "RateLimit-Remaining": str(max(0, limit - len(rows) - 1)),
    }
