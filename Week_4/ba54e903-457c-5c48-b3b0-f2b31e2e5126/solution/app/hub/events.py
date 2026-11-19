"""Live events travel through the database so every app instance sees them.

``publish`` writes a row inside the caller's transaction; each instance's dispatcher (hub/live.py)
reads new rows and delivers them to the open connections that may receive them.

Event types and their receivers:
  message.created / message.updated / message.deleted   channel_id; everyone who can view the channel
  access.changed       community_id (+ member_id): that member, or every member of the community
  members.changed      community_id: members of the community (joins, leaves, bans, presence, roles)
  notifications.changed  member_id: that member's inbox changed
  timeout.changed      community_id + member_id: that member's time-out started or ended
"""

from __future__ import annotations

import json
from typing import Any

from . import db



def publish(cur: db.Cursor, type_: str, *, community_id: int | None = None, channel_id: int | None = None,
            member_id: int | None = None, data: dict[str, Any] | None = None) -> None:
    cur.execute(
        "INSERT INTO live_events (type, community_id, channel_id, member_id, data) VALUES (%s, %s, %s, %s, %s)",
        (type_, community_id, channel_id, member_id, json.dumps(data or {})),
    )


def publish_to_members(cur: db.Cursor, type_: str, member_ids: list[int], *, community_id: int | None = None) -> None:
    """One event per receiving member (e.g. an inbox change for every recipient of a post)."""
    if member_ids:
        cur.execute(
            "INSERT INTO live_events (type, community_id, member_id) SELECT %s, %s, unnest(%s::int[])",
            (type_, community_id, member_ids),
        )
