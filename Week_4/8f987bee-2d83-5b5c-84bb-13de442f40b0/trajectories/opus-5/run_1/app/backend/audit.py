"""The tamper-evident audit log: one gapless hash chain per workspace."""

from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timezone

import asyncpg

GENESIS_HASH = "0" * 64


def audit_hash(prev_hash: str, seq: int, action: str, target_id: str, actor_email: str) -> str:
    text = f"{prev_hash}|{seq}|{action}|{target_id}|{actor_email}"
    return hashlib.sha256(text.encode()).hexdigest()


async def append_event(
    conn: asyncpg.Connection,
    *,
    workspace_id: uuid.UUID,
    action: str,
    target_id: str,
    actor_email: str,
) -> None:
    """Append one event inside the caller's transaction, so it commits with the change."""
    await conn.execute("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", str(workspace_id))
    previous = await conn.fetchrow(
        "SELECT seq, hash FROM audit_events WHERE workspace_id = $1 ORDER BY seq DESC LIMIT 1",
        workspace_id,
    )
    seq = 1 if previous is None else previous["seq"] + 1
    prev_hash = GENESIS_HASH if previous is None else previous["hash"]
    await conn.execute(
        """
        INSERT INTO audit_events (workspace_id, seq, action, target_id, actor_email, at, prev_hash, hash)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        """,
        workspace_id,
        seq,
        action,
        target_id,
        actor_email,
        datetime.now(timezone.utc),
        prev_hash,
        audit_hash(prev_hash, seq, action, target_id, actor_email),
    )
