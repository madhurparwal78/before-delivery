"""Databases, collections, provisioning, stats and compaction."""
import datetime

from .. import audit, pricing, textutil
from ..errors import TesselError

PROVISIONING_SECONDS = 2
DEFAULT_COLLECTION = "default"


def status_of(row):
    return "ready" if textutil.now() >= row["ready_at"] else "provisioning"


def lock_organization(cur, organization_id):
    """Serialize plan switches and database creations of one organization."""
    cur.value("SELECT id FROM organizations WHERE id = %s FOR UPDATE", (organization_id,))


def lock_database(cur, database_id):
    return cur.one(
        """
        SELECT id, organization_id, name, created_at, ready_at,
               last_lsn, indexed_lsn, index_generation
          FROM databases WHERE id = %s FOR UPDATE
        """,
        (database_id,),
    )


def in_scope(actor, database_id):
    return actor.scope is None or database_id in actor.scope


def lookup(cur, actor, name):
    """Find a database of the caller's organization, inside the key's scope."""
    if not isinstance(name, str):
        raise TesselError("DATABASE_NOT_FOUND")
    row = cur.one(
        """
        SELECT id, organization_id, name, created_at, ready_at,
               last_lsn, indexed_lsn, index_generation
          FROM databases WHERE organization_id = %s AND name = %s
        """,
        (actor.organization_id, name),
    )
    if row is None or not in_scope(actor, row["id"]):
        raise TesselError("DATABASE_NOT_FOUND")
    return row


def require_ready(row):
    if status_of(row) != "ready":
        raise TesselError("DATABASE_NOT_READY")


def count_for(cur, organization_id):
    return cur.value(
        "SELECT count(*) FROM databases WHERE organization_id = %s", (organization_id,)
    )


def create(cur, actor, name, ready_immediately=False):
    """Create a database under the plan limit, inside an organization lock."""
    lock_organization(cur, actor.organization_id)
    plan = cur.value(
        "SELECT plan FROM organizations WHERE id = %s", (actor.organization_id,)
    )
    taken = cur.value(
        "SELECT 1 FROM databases WHERE organization_id = %s AND name = %s",
        (actor.organization_id, name),
    )
    if taken:
        raise TesselError("DATABASE_ALREADY_EXISTS")
    if count_for(cur, actor.organization_id) >= pricing.DATABASE_LIMIT[plan]:
        raise TesselError("PLAN_LIMIT", allowed=pricing.DATABASE_LIMIT[plan])
    created = textutil.now()
    ready_at = created if ready_immediately else created + datetime.timedelta(
        seconds=PROVISIONING_SECONDS
    )
    row = cur.one(
        """
        INSERT INTO databases (organization_id, name, created_at, ready_at)
        VALUES (%s, %s, %s, %s)
        RETURNING id, organization_id, name, created_at, ready_at,
                  last_lsn, indexed_lsn, index_generation
        """,
        (actor.organization_id, name, created, ready_at),
    )
    cur.execute(
        "INSERT INTO collections (database_id, name) VALUES (%s, %s)",
        (row["id"], DEFAULT_COLLECTION),
    )
    return row


def listing(cur, actor):
    rows = cur.all(
        """
        SELECT id, name, created_at, ready_at, last_lsn, indexed_lsn, index_generation
          FROM databases WHERE organization_id = %s ORDER BY name
        """,
        (actor.organization_id,),
    )
    return [row for row in rows if in_scope(actor, row["id"])]


def delete(cur, row):
    """Remove a database at once, keeping only its token rows and audit events."""
    cur.execute(
        """
        UPDATE source_versions
           SET database_id = NULL, collection = NULL, source_id = NULL,
               version = NULL, lsn = NULL
         WHERE database_id = %s
        """,
        (row["id"],),
    )
    cur.execute("DELETE FROM databases WHERE id = %s", (row["id"],))


def collections(cur, database_id):
    return [
        item["name"]
        for item in cur.all(
            "SELECT name FROM collections WHERE database_id = %s ORDER BY name",
            (database_id,),
        )
    ]


def ensure_collection(cur, database_id, name):
    cur.execute(
        """
        INSERT INTO collections (database_id, name) VALUES (%s, %s)
        ON CONFLICT (database_id, name) DO NOTHING
        """,
        (database_id, name),
    )


def delete_collection(cur, database_id, name):
    if name == DEFAULT_COLLECTION:
        raise TesselError("COLLECTION_IS_DEFAULT")
    present = cur.value(
        "SELECT 1 FROM collections WHERE database_id = %s AND name = %s",
        (database_id, name),
    )
    if not present:
        raise TesselError("COLLECTION_NOT_FOUND")
    live = cur.value(
        """
        SELECT 1 FROM sources
         WHERE database_id = %s AND collection = %s AND NOT deleted LIMIT 1
        """,
        (database_id, name),
    )
    if live:
        raise TesselError("COLLECTION_NOT_EMPTY")
    cur.execute(
        "DELETE FROM sources WHERE database_id = %s AND collection = %s",
        (database_id, name),
    )
    cur.execute(
        "DELETE FROM collections WHERE database_id = %s AND name = %s",
        (database_id, name),
    )


def storage_bytes(cur, database_id):
    source_bytes = cur.value(
        """
        SELECT coalesce(sum(octet_length(title) + octet_length(text)), 0)
          FROM sources WHERE database_id = %s AND NOT deleted
        """,
        (database_id,),
    )
    live_facts = cur.value(
        """
        SELECT count(*) FROM facts f
          JOIN sources s ON s.database_id = f.database_id
                        AND s.collection = f.collection AND s.id = f.source_id
         WHERE f.database_id = %s AND NOT s.deleted
        """,
        (database_id,),
    )
    return int(source_bytes) + 64 * int(live_facts)


def stats(cur, row):
    database_id = row["id"]
    sources = cur.value(
        "SELECT count(*) FROM sources WHERE database_id = %s AND NOT deleted",
        (database_id,),
    )
    facts = cur.value(
        """
        SELECT count(*) FROM facts f
          JOIN sources s ON s.database_id = f.database_id
                        AND s.collection = f.collection AND s.id = f.source_id
         WHERE f.database_id = %s AND NOT s.deleted
        """,
        (database_id,),
    )
    entities = cur.value(
        """
        SELECT count(*) FROM (
            SELECT f.subject_key AS k FROM facts f
              JOIN sources s ON s.database_id = f.database_id
                            AND s.collection = f.collection AND s.id = f.source_id
             WHERE f.database_id = %s AND NOT s.deleted
            UNION
            SELECT f.object_key AS k FROM facts f
              JOIN sources s ON s.database_id = f.database_id
                            AND s.collection = f.collection AND s.id = f.source_id
             WHERE f.database_id = %s AND NOT s.deleted
        ) keys
        """,
        (database_id, database_id),
    )
    tokens_ingested = cur.value(
        "SELECT coalesce(sum(token_count), 0) FROM source_versions WHERE database_id = %s",
        (database_id,),
    )
    return {
        "sources": int(sources),
        "facts": int(facts),
        "entities": int(entities),
        "last_lsn": row["last_lsn"],
        "indexed_lsn": row["indexed_lsn"],
        "wal_pending": row["last_lsn"] - row["indexed_lsn"],
        "index_generation": row["index_generation"],
        "tokens_ingested": int(tokens_ingested),
        "storage_bytes": storage_bytes(cur, database_id),
    }


def compact(cur, database_id):
    """Fold every pending write log entry into the next index generation."""
    row = lock_database(cur, database_id)
    pending = row["last_lsn"] - row["indexed_lsn"]
    if pending <= 0:
        return {
            "generation": row["index_generation"],
            "folded_entries": 0,
            "indexed_lsn": row["indexed_lsn"],
        }
    updated = cur.one(
        """
        UPDATE databases SET indexed_lsn = last_lsn, index_generation = index_generation + 1
         WHERE id = %s RETURNING indexed_lsn, index_generation
        """,
        (database_id,),
    )
    return {
        "generation": updated["index_generation"],
        "folded_entries": pending,
        "indexed_lsn": updated["indexed_lsn"],
    }


def switch_plan(cur, actor, plan):
    """Switch the plan under the organization lock that creations also take."""
    lock_organization(cur, actor.organization_id)
    current = cur.value(
        "SELECT plan FROM organizations WHERE id = %s", (actor.organization_id,)
    )
    if current == plan:
        return current, False
    if plan == "ship" and count_for(cur, actor.organization_id) > pricing.DATABASE_LIMIT["ship"]:
        raise TesselError("PLAN_DOWNGRADE_BLOCKED")
    cur.execute(
        "UPDATE organizations SET plan = %s WHERE id = %s", (plan, actor.organization_id)
    )
    audit.write(
        cur,
        actor.organization_id,
        actor.email,
        "plan.change",
        actor.organization["name"],
        "%s -> %s" % (current, plan),
    )
    return plan, True


def owner_emails(cur, organization_id):
    return [
        row["email"]
        for row in cur.all(
            """
            SELECT email FROM members
             WHERE organization_id = %s AND role = 'owner' ORDER BY email
            """,
            (organization_id,),
        )
    ]
