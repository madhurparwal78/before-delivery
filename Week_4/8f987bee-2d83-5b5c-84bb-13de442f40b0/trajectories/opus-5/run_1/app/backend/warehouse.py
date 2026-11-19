"""Warehouse storage: one stored table per warehouse table, in the destination's own schema."""

from __future__ import annotations

import re
import uuid
from datetime import datetime
from typing import Any

import asyncpg

from .errors import ApiError
from .security import read_cursor, sign_cursor

JOB_ID_COLUMN = "_wayline_job_id"
EXTRACTED_AT_COLUMN = "_wayline_extracted_at"
METADATA_COLUMNS: tuple[str, ...] = (JOB_ID_COLUMN, EXTRACTED_AT_COLUMN)
_NON_IDENTIFIER = re.compile(r"[^a-z0-9_]")


def warehouse_schema(destination_id: uuid.UUID) -> str:
    return "warehouse_" + _NON_IDENTIFIER.sub("_", str(destination_id).lower())


def quoted(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def table_reference(destination_id: uuid.UUID, table: str) -> str:
    return f"{quoted(warehouse_schema(destination_id))}.{quoted(table)}"


async def ensure_schema(conn: asyncpg.Connection, destination_id: uuid.UUID) -> None:
    await conn.execute(f"CREATE SCHEMA IF NOT EXISTS {quoted(warehouse_schema(destination_id))}")


async def create_table(
    conn: asyncpg.Connection, destination_id: uuid.UUID, table: str, fields: list[str]
) -> None:
    columns = ", ".join(f"{quoted(name)} jsonb" for name in fields)
    await conn.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {table_reference(destination_id, table)} (
            _seq bigserial PRIMARY KEY,
            {columns},
            {quoted(JOB_ID_COLUMN)} text NOT NULL,
            {quoted(EXTRACTED_AT_COLUMN)} timestamptz NOT NULL
        )
        """
    )


async def add_columns(
    conn: asyncpg.Connection, destination_id: uuid.UUID, table: str, fields: list[str]
) -> None:
    for name in fields:
        await conn.execute(
            f"ALTER TABLE {table_reference(destination_id, table)} "
            f"ADD COLUMN IF NOT EXISTS {quoted(name)} jsonb"
        )


async def delete_rows(conn: asyncpg.Connection, destination_id: uuid.UUID, table: str) -> None:
    await conn.execute(f"DELETE FROM {table_reference(destination_id, table)}")


async def insert_rows(
    conn: asyncpg.Connection,
    destination_id: uuid.UUID,
    table: str,
    fields: list[str],
    rows: list[dict[str, Any]],
    job_id: uuid.UUID,
    extracted_at: datetime,
) -> None:
    if not rows:
        return
    columns = [quoted(name) for name in fields] + [quoted(JOB_ID_COLUMN), quoted(EXTRACTED_AT_COLUMN)]
    placeholders = ", ".join(f"${index + 1}" for index in range(len(columns)))
    statement = (
        f"INSERT INTO {table_reference(destination_id, table)} ({', '.join(columns)}) VALUES ({placeholders})"
    )
    payload = [
        [row.get(name) for name in fields] + [str(job_id), extracted_at]
        for row in rows
    ]
    await conn.executemany(statement, payload)


async def row_count(conn: asyncpg.Connection, destination_id: uuid.UUID, table: str) -> int:
    return await conn.fetchval(f"SELECT count(*) FROM {table_reference(destination_id, table)}")


async def list_tables(conn: asyncpg.Connection, destination_id: uuid.UUID) -> list[dict[str, Any]]:
    rows = await conn.fetch(
        "SELECT name FROM warehouse_tables WHERE destination_id = $1 ORDER BY name",
        destination_id,
    )
    return [
        {"name": row["name"], "row_count": await row_count(conn, destination_id, row["name"])}
        for row in rows
    ]


async def table_registration(
    conn: asyncpg.Connection, destination_id: uuid.UUID, table: str
) -> asyncpg.Record | None:
    return await conn.fetchrow(
        "SELECT name, generation, fields FROM warehouse_tables WHERE destination_id = $1 AND name = $2",
        destination_id,
        table,
    )


def _records_cursor(destination_id: uuid.UUID, table: str, generation: int, **position: int) -> str:
    return sign_cursor(
        {
            "kind": "records",
            "destination_id": str(destination_id),
            "table": table,
            "generation": generation,
            **position,
        }
    )


def read_records_cursor(cursor: str, destination_id: uuid.UUID, table: str, generation: int) -> dict[str, Any]:
    payload = read_cursor(cursor)
    if (
        payload.get("kind") != "records"
        or payload.get("destination_id") != str(destination_id)
        or payload.get("table") != table
        or payload.get("generation") != generation
    ):
        raise ApiError("invalid_cursor")
    return payload


async def read_records(
    conn: asyncpg.Connection,
    destination_id: uuid.UUID,
    table: str,
    fields: list[str],
    generation: int,
    limit: int,
    cursor: str | None,
) -> dict[str, Any]:
    reference = table_reference(destination_id, table)
    columns = ", ".join(quoted(name) for name in [*fields, *METADATA_COLUMNS])
    position = read_records_cursor(cursor, destination_id, table, generation) if cursor else {}
    if "before" in position:
        rows = await conn.fetch(
            f"SELECT _seq, {columns} FROM {reference} WHERE _seq < $1 ORDER BY _seq DESC LIMIT $2",
            position["before"],
            limit,
        )
        rows = list(reversed(rows))
    elif "after" in position:
        rows = await conn.fetch(
            f"SELECT _seq, {columns} FROM {reference} WHERE _seq > $1 ORDER BY _seq ASC LIMIT $2",
            position["after"],
            limit,
        )
    else:
        rows = await conn.fetch(f"SELECT _seq, {columns} FROM {reference} ORDER BY _seq ASC LIMIT $1", limit)
    total_count = await conn.fetchval(f"SELECT count(*) FROM {reference}")
    records = [_record_of(row, fields) for row in rows]
    next_cursor = prev_cursor = None
    has_more = False
    if rows:
        first_seq, last_seq = rows[0]["_seq"], rows[-1]["_seq"]
        has_more = bool(
            await conn.fetchval(f"SELECT exists (SELECT 1 FROM {reference} WHERE _seq > $1)", last_seq)
        )
        if has_more:
            next_cursor = _records_cursor(destination_id, table, generation, after=last_seq)
        if await conn.fetchval(f"SELECT exists (SELECT 1 FROM {reference} WHERE _seq < $1)", first_seq):
            prev_cursor = _records_cursor(destination_id, table, generation, before=first_seq)
    return {
        "records": records,
        "next_cursor": next_cursor,
        "prev_cursor": prev_cursor,
        "has_more": has_more,
        "total_count": total_count,
    }


def _record_of(row: asyncpg.Record, fields: list[str]) -> dict[str, Any]:
    record: dict[str, Any] = {name: row[name] for name in fields}
    record[JOB_ID_COLUMN] = row[JOB_ID_COLUMN]
    extracted_at = row[EXTRACTED_AT_COLUMN]
    record[EXTRACTED_AT_COLUMN] = extracted_at.isoformat().replace("+00:00", "Z")
    return record


async def drop_orphan_schemas(conn: asyncpg.Connection) -> None:
    """Warehouse schemas of destinations that no longer exist are dropped on start."""
    live = {warehouse_schema(row["id"]) for row in await conn.fetch("SELECT id FROM destinations")}
    names = await conn.fetch(
        "SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'warehouse\\_%'"
    )
    for row in names:
        if row["schema_name"] not in live:
            await conn.execute(f"DROP SCHEMA {quoted(row['schema_name'])} CASCADE")
