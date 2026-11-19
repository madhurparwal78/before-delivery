"""The append-only audit trail. Entries are written in the same transaction as the
change they record, and are never edited or deleted."""

from .. import clock
from ..seed import SYSTEM_ACTOR_ID
from . import people


def write(cursor, at, actor_id, action, directive_id, thread_id, detail):
    cursor.execute(
        """INSERT INTO audit (at, actor_id, action, directive_id, thread_id, detail)
           VALUES (%s,%s,%s,%s,%s,%s)""",
        (at, actor_id or SYSTEM_ACTOR_ID, action, directive_id, thread_id, detail),
    )


def entries(cursor, directive_id=None, thread_id=None, limit=500):
    rows = cursor.all(
        """SELECT id, at, actor_id, action, directive_id, thread_id, detail
             FROM audit
            WHERE (%s::text IS NULL OR directive_id = %s) AND (%s::text IS NULL OR thread_id = %s)
            ORDER BY at DESC, id DESC LIMIT %s""",
        (directive_id, directive_id, thread_id, thread_id, limit),
    )
    registry = people.load_people(cursor)
    return [
        {
            "id": str(row["id"]),
            "at": clock.iso(row["at"]),
            "actor": people.person(registry.get(row["actor_id"])),
            "action": row["action"],
            "directive_id": row["directive_id"],
            "thread_id": row["thread_id"],
            "detail": row["detail"],
        }
        for row in rows
    ]
