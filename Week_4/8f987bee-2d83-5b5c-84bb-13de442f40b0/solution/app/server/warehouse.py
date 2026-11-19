"""Warehouse storage: one stored table per warehouse table in the destination's own schema, table generations,
the reset, and records paged by write position."""

import re
import uuid
from datetime import datetime
from typing import Any

import asyncpg

from . import paging
from .db import iso, utcnow
from .errors import not_found

META_COLUMNS = ("_wayline_job_id", "_wayline_extracted_at")


def schema_name(destination_id: uuid.UUID) -> str:
    return "warehouse_" + re.sub(r"[^a-z0-9_]", "_", str(destination_id).lower())


def _quote(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _qualified(destination_id: uuid.UUID, table: str) -> str:
    return f"{_quote(schema_name(destination_id))}.{_quote(table)}"


async def create_schema(conn: asyncpg.Connection, destination_id: uuid.UUID) -> None:
    await conn.execute(f"CREATE SCHEMA IF NOT EXISTS {_quote(schema_name(destination_id))}")


async def write(conn: asyncpg.Connection, *, destination_id: uuid.UUID, table: str, connection_id: uuid.UUID,
                columns: list[str], mode: str, rows: list[dict[str, Any]], job_id: uuid.UUID,
                extracted_at: datetime) -> None:
    """Write one stream's rows inside the sync commit transaction."""
    target = _qualified(destination_id, table)
    await conn.execute(
        f"""CREATE TABLE IF NOT EXISTS {target} (
                _wayline_ordinal bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                _wayline_job_id uuid NOT NULL,
                _wayline_extracted_at timestamptz NOT NULL,
                record jsonb NOT NULL)""")
    await conn.execute(
        """INSERT INTO warehouse_tables (destination_id, name, connection_id, generation, columns, created_at)
           VALUES ($1, $2, $3, 1, $4, $5)
           ON CONFLICT (destination_id, name) DO UPDATE SET connection_id = EXCLUDED.connection_id,
                                                            columns = EXCLUDED.columns""",
        destination_id, table, connection_id, columns, utcnow())
    if mode == "full_refresh_overwrite":
        await conn.execute(f"DELETE FROM {target}")
        await new_generation(conn, destination_id, table)
    if mode == "incremental_dedup":
        await conn.execute(f"DELETE FROM {target} WHERE record->>'id' = ANY($1::text[])",
                           [str(row["id"]) for row in rows])
    await conn.execute(
        f"""INSERT INTO {target} (_wayline_job_id, _wayline_extracted_at, record)
            SELECT $2, $3, item FROM jsonb_array_elements($1::jsonb) WITH ORDINALITY AS u(item, n) ORDER BY n""",
        rows, job_id, extracted_at)


async def new_generation(conn: asyncpg.Connection, destination_id: uuid.UUID, table: str) -> None:
    await conn.execute("UPDATE warehouse_tables SET generation = generation + 1 WHERE destination_id = $1 AND name = $2",
                       destination_id, table)


async def reset(conn: asyncpg.Connection, connection_id: uuid.UUID) -> None:
    """Empty every table a sync of this connection created and start a new generation of each."""
    for row in await conn.fetch("SELECT destination_id, name FROM warehouse_tables WHERE connection_id = $1",
                                connection_id):
        await conn.execute(f"DELETE FROM {_qualified(row['destination_id'], row['name'])}")
        await new_generation(conn, row["destination_id"], row["name"])


async def tables(conn: asyncpg.Connection, destination_id: uuid.UUID) -> list[dict[str, Any]]:
    listed = []
    for row in await conn.fetch("SELECT name FROM warehouse_tables WHERE destination_id = $1 ORDER BY name",
                                destination_id):
        count = await conn.fetchval(f"SELECT count(*) FROM {_qualified(destination_id, row['name'])}")
        listed.append({"name": row["name"], "row_count": count})
    return listed


async def table_of(conn: asyncpg.Connection, destination_id: uuid.UUID, name: str) -> asyncpg.Record:
    """The object check for `{table}`: exactly a name the destination's table list holds."""
    row = await conn.fetchrow("SELECT name, generation, columns FROM warehouse_tables WHERE destination_id = $1 "
                              "AND name = $2", destination_id, name)
    if row is None:
        raise not_found()
    return row


def _public(record: dict[str, Any], columns: list[str], job_id: uuid.UUID, extracted: datetime) -> dict[str, Any]:
    return {**{name: record.get(name) for name in columns}, "_wayline_job_id": str(job_id),
            "_wayline_extracted_at": iso(extracted)}


async def records_page(conn: asyncpg.Connection, workspace_id: uuid.UUID, destination_id: uuid.UUID,
                       table: asyncpg.Record, limit: int, cursor: str | None) -> dict[str, Any]:
    scope = {"k": "records", "w": str(workspace_id), "d": str(destination_id), "t": table["name"],
             "g": table["generation"]}
    position = paging.decode(cursor, scope) if cursor else {"after": 0}
    target = _qualified(destination_id, table["name"])
    select = f"SELECT _wayline_ordinal AS o, _wayline_job_id, _wayline_extracted_at, record FROM {target}"
    if "before" in position:
        rows = list(reversed(await conn.fetch(f"{select} WHERE _wayline_ordinal < $1 ORDER BY _wayline_ordinal DESC "
                                              "LIMIT $2", position["before"], limit)))
    else:
        rows = await conn.fetch(f"{select} WHERE _wayline_ordinal > $1 ORDER BY _wayline_ordinal LIMIT $2",
                                position["after"], limit)
    total = await conn.fetchval(f"SELECT count(*) FROM {target}")
    has_more = has_before = False
    if rows:
        has_more = await conn.fetchval(f"SELECT EXISTS (SELECT 1 FROM {target} WHERE _wayline_ordinal > $1)",
                                       rows[-1]["o"])
        has_before = await conn.fetchval(f"SELECT EXISTS (SELECT 1 FROM {target} WHERE _wayline_ordinal < $1)",
                                         rows[0]["o"])
    return {
        "records": [_public(r["record"], table["columns"], r["_wayline_job_id"], r["_wayline_extracted_at"])
                    for r in rows],
        "next_cursor": paging.encode(scope, {"after": rows[-1]["o"]}) if has_more else None,
        "prev_cursor": paging.encode(scope, {"before": rows[0]["o"]}) if has_before else None,
        "has_more": has_more,
        "total_count": total,
    }
