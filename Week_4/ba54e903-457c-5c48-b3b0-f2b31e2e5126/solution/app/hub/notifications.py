"""The notification inbox: only entries the recipient may see now, newest first, paged by id."""

from __future__ import annotations

from typing import Any

from flask import g

from . import communities, db, events, perms
from .errors import ApiError
from .router import route
from .serialize import iso, public_user

DEFAULT_LIMIT = 20
MAX_LIMIT = 50

_VISIBLE_FROM = """
FROM notifications n LEFT JOIN messages m ON m.id = n.message_id LEFT JOIN members a ON a.id = n.actor_id
WHERE n.recipient_id = %(me)s
  AND ((n.message_id IS NULL AND n.community_id = ANY(%(communities)s)) OR m.channel_id = ANY(%(channels)s))
"""


def _scope(cur: db.Cursor, member_id: int) -> dict[str, Any]:
    """The communities the member belongs to and the channels they may view in them, right now."""
    cur.execute("SELECT community_id FROM memberships WHERE member_id = %s", (member_id,))
    community_ids = [row["community_id"] for row in cur.fetchall()]
    channel_ids = [c["id"] for cid in community_ids
                   for c in communities.viewable_channels(cur, perms.load_access(cur, member_id, cid))]
    return {"me": member_id, "communities": community_ids, "channels": channel_ids}


def _unread_count(cur: db.Cursor, scope: dict[str, Any]) -> int:
    cur.execute("SELECT count(*) AS n " + _VISIBLE_FROM + " AND NOT n.read", scope)
    return cur.fetchone()["n"]


@route("GET", "/api/notifications", session="required")
def inbox():
    unread_only = g.query.flag("unread")
    limit = g.query.integer("limit", DEFAULT_LIMIT, 1, MAX_LIMIT)
    before = g.query.integer("before", None, 1, 2147483647)
    with db.tx() as cur:
        scope = _scope(cur, g.member["id"])
        cur.execute(
            "SELECT n.id, n.kind, n.read, n.created_at, n.message_id, m.channel_id, n.community_id, n.actor_id, "
            "a.username AS a_username, a.display_name AS a_display_name " + _VISIBLE_FROM +
            " AND (NOT %(unread)s OR NOT n.read) AND (%(before)s::int IS NULL OR n.id < %(before)s) "
            "ORDER BY n.id DESC LIMIT %(limit)s",
            {**scope, "unread": unread_only, "before": before, "limit": limit + 1})
        rows = cur.fetchall()
        entries = [{
            "id": r["id"], "kind": r["kind"], "read": r["read"], "created_at": iso(r["created_at"]),
            "message_id": r["message_id"], "channel_id": r["channel_id"], "community_id": r["community_id"],
            "actor": None if r["actor_id"] is None else public_user(
                {"id": r["actor_id"], "username": r["a_username"], "display_name": r["a_display_name"]}),
        } for r in rows[:limit]]
        return {"data": entries, "unread_count": _unread_count(cur, scope), "has_more": len(rows) > limit}


@route("POST", "/api/notifications/{id}/read", session="required")
def mark_read(id: int):
    with db.tx() as cur:
        scope = _scope(cur, g.member["id"])
        cur.execute("UPDATE notifications SET read = true WHERE id IN (SELECT n.id " + _VISIBLE_FROM +
                    " AND n.id = %(id)s) RETURNING id", {**scope, "id": id})
        if cur.fetchone() is None:
            raise ApiError("not_found")
        events.publish_to_members(cur, "notifications.changed", [g.member["id"]])
        return {"id": id, "read": True}


@route("POST", "/api/notifications/read-all", session="required")
def mark_all_read():
    with db.tx() as cur:
        scope = _scope(cur, g.member["id"])
        cur.execute("UPDATE notifications SET read = true WHERE id IN (SELECT n.id " + _VISIBLE_FROM +
                    " AND NOT n.read)", scope)
        updated = cur.rowcount
        if updated:
            events.publish_to_members(cur, "notifications.changed", [g.member["id"]])
        return {"updated": updated}
