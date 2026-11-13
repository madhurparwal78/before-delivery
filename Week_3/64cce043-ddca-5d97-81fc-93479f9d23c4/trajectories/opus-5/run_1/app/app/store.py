"""Reading a vault out of Postgres and keeping its done marks honest."""
from __future__ import annotations

import asyncpg

from .domain.exposure import VaultView, compute
from .domain.records import Breach, GradingRule, Holding

HOLDING_COLUMNS = (
    "id, company, company_key, data_kind, value, notes, version, created_at, updated_at"
)
RULE_COLUMNS = "id, priority, data_kind, company_contains, level, version, created_at"
BREACH_COLUMNS = "id, company, company_key, announced_on, data_kinds, version, created_at"


def _holding(row: asyncpg.Record) -> Holding:
    return Holding(
        id=row["id"],
        company=row["company"],
        company_key=row["company_key"],
        data_kind=row["data_kind"],
        value=row["value"],
        notes=row["notes"],
        version=row["version"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _rule(row: asyncpg.Record) -> GradingRule:
    return GradingRule(
        id=row["id"],
        priority=row["priority"],
        data_kind=row["data_kind"],
        company_contains=row["company_contains"],
        level=row["level"],
        version=row["version"],
        created_at=row["created_at"],
    )


def _breach(row: asyncpg.Record) -> Breach:
    return Breach(
        id=row["id"],
        company=row["company"],
        company_key=row["company_key"],
        announced_on=row["announced_on"],
        data_kinds=tuple(row["data_kinds"]),
        version=row["version"],
        created_at=row["created_at"],
    )


async def load_holdings(connection: asyncpg.Connection, vault_id: str) -> list[Holding]:
    rows = await connection.fetch(
        f"select {HOLDING_COLUMNS} from holdings where vault_id = $1", vault_id
    )
    return [_holding(row) for row in rows]


async def load_rules(connection: asyncpg.Connection, vault_id: str) -> list[GradingRule]:
    rows = await connection.fetch(
        f"select {RULE_COLUMNS} from grading_rules where vault_id = $1", vault_id
    )
    return [_rule(row) for row in rows]


async def load_breaches(connection: asyncpg.Connection, vault_id: str) -> list[Breach]:
    rows = await connection.fetch(
        f"""select {BREACH_COLUMNS} from breaches where vault_id = $1
            order by announced_on desc, created_at desc""",
        vault_id,
    )
    return [_breach(row) for row in rows]


async def load_done_marks(connection: asyncpg.Connection, vault_id: str) -> set[str]:
    rows = await connection.fetch(
        "select step_id from step_done where vault_id = $1", vault_id
    )
    return {row["step_id"] for row in rows}


async def load_view(
    connection: asyncpg.Connection,
    vault_id: str,
    scope_levels: frozenset[str] | None = None,
) -> VaultView:
    """One computation over the vault's current state, scoped for a trusted contact."""
    return compute(
        vault_id,
        await load_holdings(connection, vault_id),
        await load_rules(connection, vault_id),
        await load_breaches(connection, vault_id),
        await load_done_marks(connection, vault_id),
        scope_levels,
    )


async def prune_done_marks(connection: asyncpg.Connection, vault_id: str) -> VaultView:
    """Drop done marks whose step has left the vault's step list, and return the
    owner's view of the committed state.

    A mark outside the step list is invisible to the computation, so the view read
    before the prune already describes the committed state.
    """
    view = await load_view(connection, vault_id)
    await connection.execute(
        "delete from step_done where vault_id = $1 and not (step_id = any($2::text[]))",
        vault_id,
        list(view.valid_step_ids()),
    )
    return view
