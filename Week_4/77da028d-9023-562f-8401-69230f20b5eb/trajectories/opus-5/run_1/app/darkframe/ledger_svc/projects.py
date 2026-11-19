"""Projects, allotments and the paired hours-owed ledger."""

from __future__ import annotations

from typing import Any, Awaitable, Callable, Sequence

import asyncpg

from .. import ids
from ..domain import filters, paired_ledger as ledger_rules, states, timeutil
from ..errors import conflict, not_found
from .store import DATABASE


async def project_row(imager_id: str, project_id: str) -> asyncpg.Record:
    row = await DATABASE.fetchrow(
        "select * from ledger.projects where id = $1 and imager_id = $2",
        project_id,
        imager_id,
    )
    if row is None:
        raise not_found()
    return row


async def filter_totals(
    project_id: str, connection: asyncpg.Connection | None = None
) -> list[dict[str, Any]]:
    sql = """
        select filter,
               -coalesce(sum(case when account = 'allotment' then seconds end), 0)
                   as planned_seconds,
               coalesce(sum(case when account = 'integrated' then seconds end), 0)
                   as logged_seconds,
               coalesce(sum(case when account = 'owed' then seconds end), 0)
                   as owed_seconds
        from ledger.entries where project_id = $1 group by filter
    """
    rows = (
        await connection.fetch(sql, project_id)
        if connection is not None
        else await DATABASE.fetch(sql, project_id)
    )
    totals = {row["filter"]: row for row in rows}
    return [
        {
            "filter": name,
            "planned_seconds": int(totals[name]["planned_seconds"]),
            "logged_seconds": int(totals[name]["logged_seconds"]),
            "owed_seconds": int(totals[name]["owed_seconds"]),
        }
        for name in filters.FILTER_ORDER
        if name in totals
    ]


async def project_body(row: asyncpg.Record) -> dict[str, Any]:
    totals = await filter_totals(row["id"])
    session_count = await DATABASE.fetchval(
        "select count(*) from ledger.sessions "
        "where project_id = $1 and state <> 'trashed'",
        row["id"],
    )
    return {
        "id": row["id"],
        "name": row["name"],
        "target_name": row["target_name"],
        "ra_deg": row["ra_deg"],
        "dec_deg": row["dec_deg"],
        "state": row["state"],
        "filters": totals,
        "total_integration_seconds": sum(item["logged_seconds"] for item in totals),
        "session_count": int(session_count),
    }


async def post_movement(
    connection: asyncpg.Connection,
    *,
    imager_id: str,
    project_id: str,
    kind: str,
    filter_name: str,
    entries: Sequence[ledger_rules.Entry],
    session_id: str | None = None,
    batch_id: str | None = None,
    reverses_movement_id: str | None = None,
) -> str:
    movement_id = ids.record_id("mov")
    now = timeutil.now_utc()
    await connection.executemany(
        """
        insert into ledger.entries (id, movement_id, movement_kind, imager_id,
            project_id, filter, account, seconds, session_id, batch_id,
            reverses_movement_id, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        """,
        [
            (
                ids.record_id("ent"),
                movement_id,
                kind,
                imager_id,
                project_id,
                filter_name,
                entry.account,
                entry.seconds,
                session_id,
                batch_id,
                reverses_movement_id,
                now,
            )
            for entry in entries
        ],
    )
    return movement_id


async def movement_entries(
    connection: asyncpg.Connection, movement_id: str
) -> list[ledger_rules.Entry]:
    rows = await connection.fetch(
        "select account, seconds from ledger.entries where movement_id = $1 "
        "order by sequence",
        movement_id,
    )
    return [ledger_rules.Entry(row["account"], int(row["seconds"])) for row in rows]


async def reverse_movement(
    connection: asyncpg.Connection,
    *,
    imager_id: str,
    project_id: str,
    movement_id: str,
    filter_name: str,
    session_id: str | None,
    batch_id: str | None,
) -> str:
    entries = ledger_rules.reversal_entries(
        await movement_entries(connection, movement_id)
    )
    return await post_movement(
        connection,
        imager_id=imager_id,
        project_id=project_id,
        kind=ledger_rules.REVERSAL,
        filter_name=filter_name,
        entries=entries,
        session_id=session_id,
        batch_id=batch_id,
        reverses_movement_id=movement_id,
    )


async def unreversed_log_movements(
    connection: asyncpg.Connection, session_id: str
) -> list[asyncpg.Record]:
    return list(
        await connection.fetch(
            """
            select distinct on (e.movement_id)
                   e.movement_id, e.batch_id, e.filter, e.project_id, e.sequence
            from ledger.entries e
            where e.session_id = $1 and e.movement_kind = 'log'
              and not exists (
                  select 1 from ledger.entries r
                  where r.reverses_movement_id = e.movement_id)
            order by e.movement_id, e.sequence
            """,
            session_id,
        )
    )


async def latest_unreversed_log_for_batch(
    connection: asyncpg.Connection, batch_id: str
) -> asyncpg.Record | None:
    return await connection.fetchrow(
        """
        select e.movement_id, e.filter, max(e.sequence) as last_sequence
        from ledger.entries e
        where e.batch_id = $1 and e.movement_kind = 'log'
          and not exists (
              select 1 from ledger.entries r
              where r.reverses_movement_id = e.movement_id)
        group by e.movement_id, e.filter
        order by last_sequence desc
        limit 1
        """,
        batch_id,
    )


async def create_project(
    imager_id: str, name: str, target_name: str, ra_deg: float, dec_deg: float
) -> asyncpg.Record:
    project_id = ids.record_id("prj")
    await DATABASE.execute(
        """
        insert into ledger.projects
            (id, imager_id, name, target_name, ra_deg, dec_deg, state)
        values ($1, $2, $3, $4, $5, $6, 'draft')
        """,
        project_id,
        imager_id,
        name,
        target_name,
        ra_deg,
        dec_deg,
    )
    return await project_row(imager_id, project_id)


async def set_allotment(
    imager_id: str,
    project_id: str,
    filter_name: str,
    read_planned: Callable[[], Awaitable[int]],
) -> None:
    """The closed-project guard runs before the field validation."""
    async with DATABASE.transaction() as connection:
        row = await connection.fetchrow(
            "select state from ledger.projects where id = $1 and imager_id = $2 "
            "for update",
            project_id,
            imager_id,
        )
        if row is None:
            raise not_found()
        closed = states.closed_project(row["state"])
        if closed is not None:
            raise closed
        planned_seconds = await read_planned()
        previous = int(
            await connection.fetchval(
                "select -coalesce(sum(seconds), 0) from ledger.entries "
                "where project_id = $1 and filter = $2 and account = 'allotment'",
                project_id,
                filter_name,
            )
        )
        entries = ledger_rules.allot_entries(previous, planned_seconds)
        if entries:
            await post_movement(
                connection,
                imager_id=imager_id,
                project_id=project_id,
                kind=ledger_rules.ALLOT,
                filter_name=filter_name,
                entries=entries,
            )


async def transition(imager_id: str, project_id: str, to_state: str) -> None:
    async with DATABASE.transaction() as connection:
        row = await connection.fetchrow(
            "select state from ledger.projects where id = $1 and imager_id = $2 "
            "for update",
            project_id,
            imager_id,
        )
        if row is None:
            raise not_found()
        from_state = row["state"]
        illegal = states.project_transition(from_state, to_state)
        if illegal is not None:
            raise illegal
        totals = await filter_totals(project_id, connection)
        if to_state == "active" and from_state == "draft":
            if not any(item["planned_seconds"] > 0 for item in totals):
                raise conflict(
                    "no_allotments",
                    "Plan time for at least one filter before activating.",
                )
        if to_state == "complete":
            if any(item["owed_seconds"] > 0 for item in totals):
                raise conflict(
                    "hours_still_owed", "This project still owes imaging time."
                )
        await connection.execute(
            "update ledger.projects set state = $2 where id = $1", project_id, to_state
        )


async def ledger_entries(project_id: str) -> list[dict[str, Any]]:
    rows = await DATABASE.fetch(
        "select * from ledger.entries where project_id = $1 order by sequence",
        project_id,
    )
    return [
        {
            "id": row["id"],
            "movement_id": row["movement_id"],
            "movement_kind": row["movement_kind"],
            "filter": row["filter"],
            "account": row["account"],
            "seconds": int(row["seconds"]),
            "session_id": row["session_id"],
            "batch_id": row["batch_id"],
            "reverses_movement_id": row["reverses_movement_id"],
            "created_at": timeutil.iso_utc(row["created_at"]),
        }
        for row in rows
    ]


async def allotted_filters(project_id: str) -> set[str]:
    rows = await DATABASE.fetch(
        "select distinct filter from ledger.entries where project_id = $1",
        project_id,
    )
    return {row["filter"] for row in rows}
