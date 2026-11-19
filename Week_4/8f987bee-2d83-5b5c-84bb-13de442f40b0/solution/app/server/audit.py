"""The tamper-evident audit log: gapless per-workspace numbering and a SHA-256 hash chain."""

import hashlib
import uuid

import asyncpg

from .db import iso, utcnow

GENESIS = "0" * 64


def chain_hash(prev_hash: str, seq: int, action: str, target_id: str, actor_email: str) -> str:
    return hashlib.sha256(f"{prev_hash}|{seq}|{action}|{target_id}|{actor_email}".encode()).hexdigest()


async def append(conn: asyncpg.Connection, workspace_id: uuid.UUID, action: str, target_id: object,
                 actor_email: str) -> None:
    """Append one event inside the caller's transaction; the workspace row lock orders simultaneous changes.
    NO KEY UPDATE leaves the key-share locks that inserts referencing the workspace take free."""
    await conn.execute("SELECT 1 FROM workspaces WHERE id = $1 FOR NO KEY UPDATE", workspace_id)
    last = await conn.fetchrow("SELECT seq, hash FROM audit_events WHERE workspace_id = $1 ORDER BY seq DESC LIMIT 1",
                               workspace_id)
    seq = last["seq"] + 1 if last else 1
    prev_hash = last["hash"] if last else GENESIS
    target = str(target_id)
    await conn.execute(
        """INSERT INTO audit_events (workspace_id, seq, action, target_id, actor_email, at, prev_hash, hash)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)""",
        workspace_id, seq, action, target, actor_email, utcnow(), prev_hash,
        chain_hash(prev_hash, seq, action, target, actor_email))


def public(row: asyncpg.Record) -> dict:
    return {"seq": row["seq"], "action": row["action"], "target_id": row["target_id"],
            "actor_email": row["actor_email"], "at": iso(row["at"]), "prev_hash": row["prev_hash"],
            "hash": row["hash"]}
