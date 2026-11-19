"""The paired-entry hours-owed ledger. Every movement writes two entries whose seconds sum to zero."""
from typing import Any

import asyncpg

from darkframe.common.ids import new_id

FILTERS = ("L", "R", "G", "B", "Ha", "OIII", "SII")


async def _post(connection: asyncpg.Connection, *, kind: str, project_id: str, filter_name: str,
                pair: tuple[tuple[str, int], tuple[str, int]], session_id: str | None = None,
                batch_id: str | None = None, reverses: str | None = None, movement_id: str | None = None) -> str:
    movement = movement_id or new_id()
    for account, seconds in pair:
        await connection.execute(
            "INSERT INTO ledger.entries (id, movement_id, movement_kind, project_id, filter, account, seconds, "
            "session_id, batch_id, reverses_movement_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
            new_id(), movement, kind, project_id, filter_name, account, seconds, session_id, batch_id, reverses)
    return movement


async def post_allotment(connection: asyncpg.Connection, project_id: str, filter_name: str, change: int,
                         movement_id: str | None = None) -> None:
    """Setting planned time from P to Q posts owed +(Q-P) and allotment -(Q-P)."""
    await _post(connection, kind="allot", project_id=project_id, filter_name=filter_name,
                pair=(("owed", change), ("allotment", -change)), movement_id=movement_id)


async def post_log(connection: asyncpg.Connection, project_id: str, session_id: str, batch_id: str,
                   filter_name: str, integration_seconds: int, movement_id: str | None = None) -> None:
    """Logging a batch of integration E posts owed -E and integrated +E."""
    await _post(connection, kind="log", project_id=project_id, filter_name=filter_name,
                pair=(("owed", -integration_seconds), ("integrated", integration_seconds)), session_id=session_id,
                batch_id=batch_id, movement_id=movement_id)


async def reverse(connection: asyncpg.Connection, movement_id: str) -> None:
    """Post the exact negation of both entries of a movement, naming it."""
    entries = await connection.fetch("SELECT * FROM ledger.entries WHERE movement_id = $1 ORDER BY seq", movement_id)
    reversal = new_id()
    for entry in entries:
        await connection.execute(
            "INSERT INTO ledger.entries (id, movement_id, movement_kind, project_id, filter, account, seconds, "
            "session_id, batch_id, reverses_movement_id) VALUES ($1, $2, 'reversal', $3, $4, $5, $6, $7, $8, $9)",
            new_id(), reversal, entry["project_id"], entry["filter"], entry["account"], -entry["seconds"],
            entry["session_id"], entry["batch_id"], movement_id)


async def unreversed_logs(connection: asyncpg.Connection, *, session_id: str | None = None,
                          batch_id: str | None = None) -> list[str]:
    """Movement ids of log movements not yet reversed, for a session or a single batch, oldest first."""
    rows = await connection.fetch(
        "SELECT e.movement_id FROM ledger.entries e WHERE e.movement_kind = 'log' "
        "AND ($1::text IS NULL OR e.session_id = $1) AND ($2::text IS NULL OR e.batch_id = $2) "
        "AND NOT EXISTS (SELECT 1 FROM ledger.entries r WHERE r.reverses_movement_id = e.movement_id) "
        "GROUP BY e.movement_id ORDER BY min(e.seq)", session_id, batch_id)
    return [row["movement_id"] for row in rows]


async def project_filters(connection: asyncpg.Connection, project_id: str) -> list[dict[str, Any]]:
    """Planned, logged and owed seconds per filter, computed only from the entries."""
    rows = await connection.fetch(
        "SELECT filter, COALESCE(-sum(seconds) FILTER (WHERE account = 'allotment'), 0) AS planned_seconds, "
        "COALESCE(sum(seconds) FILTER (WHERE account = 'integrated'), 0) AS logged_seconds, "
        "COALESCE(sum(seconds) FILTER (WHERE account = 'owed'), 0) AS owed_seconds "
        "FROM ledger.entries WHERE project_id = $1 GROUP BY filter", project_id)
    by_name = {row["filter"]: {key: row[key] for key in ("filter", "planned_seconds", "logged_seconds", "owed_seconds")}
               for row in rows}
    return [by_name[name] for name in FILTERS if name in by_name]
