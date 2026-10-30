"""The append-only audit log: one entry per audited action, written in the change's own transaction."""

import asyncpg

from .ids import new_id


async def record(conn: asyncpg.Connection, actor: asyncpg.Record, action: str, home_id: str, target: tuple[str, str],
                 before: dict | None, after: dict | None, reason: str | None) -> None:
    """The actor's name and role are copied in as they are now, like every name inside before and after."""
    await conn.execute(
        "INSERT INTO audit_entries (id, actor_id, actor_name, actor_role, action, home_id, target_type, target_id,"
        " before, after, reason) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
        new_id("au"), actor["id"], actor["display_name"], actor["role"], action, home_id, *target, before, after,
        reason)
