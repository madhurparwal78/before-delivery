"""Object checks: a path id must be well formed and belong to the caller's workspace, or the answer is 404."""

import uuid

import asyncpg

from .errors import not_found

TABLES = {
    "source": "sources",
    "destination": "destinations",
    "connection": "connections",
    "job": "jobs",
    "project": "builder_projects",
}


def parse_id(text: str) -> uuid.UUID | None:
    try:
        return uuid.UUID(text) if len(text) == 36 else None
    except ValueError:
        return None


async def owned(conn: asyncpg.Connection, kind: str, raw_id: str, workspace_id: uuid.UUID,
                lock: bool = False) -> asyncpg.Record:
    """The object of `kind` named by `raw_id` in this workspace, optionally locked for the caller's transaction."""
    object_id = parse_id(raw_id)
    if object_id is None:
        raise not_found()
    suffix = " FOR UPDATE" if lock else ""
    row = await conn.fetchrow(f"SELECT * FROM {TABLES[kind]} WHERE id = $1 AND workspace_id = $2{suffix}",
                              object_id, workspace_id)
    if row is None:
        raise not_found()
    return row
