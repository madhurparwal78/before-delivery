"""The append-only audit log."""

from __future__ import annotations

import json
import uuid

from ..db import execute

ACTIONS = (
    "attendance_corrected",
    "attendance_added",
    "floor_override",
    "floor_version_added",
    "policy_version_added",
    "leave_cancelled",
)


def write_entry(
    conn,
    *,
    actor: dict,
    action: str,
    home_id: str,
    target_type: str,
    target_id: str,
    before: dict | None,
    after: dict,
    reason: str | None,
) -> None:
    """One entry, in the same transaction as the change, with the names of the moment."""
    execute(
        conn,
        """INSERT INTO audit_entries (id, actor_id, actor_display_name, actor_role, action,
                                      home_id, target_type, target_id, before_state,
                                      after_state, reason)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s)""",
        (
            f"aud-{uuid.uuid4().hex}",
            actor["id"],
            actor["display_name"],
            actor["role"],
            action,
            home_id,
            target_type,
            target_id,
            None if before is None else json.dumps(before),
            json.dumps(after),
            reason,
        ),
    )
