"""Connections: their validation, their versions and the settings a job will run on."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

import asyncpg

from .context import iso
from .cron import CronError, known_time_zone, parse_cron
from .errors import ApiError, validation_error
from .models import ScheduleBody, StreamBody
from .plans import cron_allowed, interval_allowed
from .scheduling import compute_next_run
from .validation import NAMESPACE_PREFIX, well_formed_id

INCREMENTAL_MODES: tuple[str, ...] = ("incremental_append", "incremental_dedup")
FULL_REFRESH_MODES: tuple[str, ...] = ("full_refresh_overwrite", "full_refresh_append")


def connection_payload(row: asyncpg.Record) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "workspace_id": str(row["workspace_id"]),
        "name": row["name"],
        "status": row["status"],
        "version": row["version"],
        "source_id": str(row["source_id"]),
        "destination_id": str(row["destination_id"]),
        "namespace_prefix": row["namespace_prefix"],
        "streams": row["streams"],
        "schedule": row["schedule"],
        "schema_change_policy": row["schema_change_policy"],
        "created_at": iso(row["created_at"]),
        "next_run_at": iso(row["next_run_at"]),
    }


def normalized_schedule(schedule: ScheduleBody) -> dict[str, Any]:
    """A schedule holds only the keys its own type uses."""
    fields: dict[str, str] = {}
    if schedule.type == "manual":
        return {"type": "manual"}
    if schedule.type == "interval":
        if schedule.interval_minutes is None:
            fields["schedule.interval_minutes"] = "This field is required."
            raise validation_error(fields)
        return {"type": "interval", "interval_minutes": schedule.interval_minutes}
    if schedule.cron_expression is None:
        fields["schedule.cron_expression"] = "This field is required."
    else:
        try:
            parse_cron(schedule.cron_expression)
        except CronError:
            fields["schedule.cron_expression"] = "This cron expression cannot be read."
    time_zone = schedule.time_zone if schedule.time_zone is not None else "UTC"
    if not known_time_zone(time_zone):
        fields["schedule.time_zone"] = "This is not a known IANA time zone name."
    if fields:
        raise validation_error(fields)
    return {"type": "cron", "cron_expression": schedule.cron_expression, "time_zone": time_zone}


def validate_streams(
    submitted: list[StreamBody], catalog: list[dict[str, Any]], custom_source: bool
) -> list[dict[str, Any]]:
    fields: dict[str, str] = {}
    by_name = {stream["name"]: stream for stream in catalog}
    streams: list[dict[str, Any]] = []
    for index, entry in enumerate(submitted):
        catalog_stream = by_name.get(entry.name)
        if catalog_stream is None:
            fields[f"streams.{index}.name"] = "This stream is not in the source catalog."
            continue
        allowed = FULL_REFRESH_MODES if custom_source else catalog_stream["supported_sync_modes"]
        if entry.sync_mode not in allowed:
            fields[f"streams.{index}.sync_mode"] = "This sync mode is not supported for this stream."
        if entry.sync_mode in INCREMENTAL_MODES and entry.cursor_field != "updated_at":
            fields[f"streams.{index}.cursor_field"] = "An incremental stream needs the cursor field updated_at."
        if entry.sync_mode == "incremental_dedup" and entry.primary_key != ["id"]:
            fields[f"streams.{index}.primary_key"] = "Incremental dedup needs the primary key [\"id\"]."
        streams.append(
            {
                "name": entry.name,
                "selected": entry.selected,
                "sync_mode": entry.sync_mode,
                "cursor_field": entry.cursor_field if entry.sync_mode in INCREMENTAL_MODES else None,
                "primary_key": entry.primary_key,
                "known_fields": list(catalog_stream["fields"]),
            }
        )
    if not fields and not any(stream["selected"] for stream in streams):
        fields["streams"] = "Select at least one stream."
    if fields:
        raise validation_error(fields)
    order = [stream["name"] for stream in catalog]
    return sorted(streams, key=lambda stream: order.index(stream["name"]))


def validate_prefix(prefix: str) -> str:
    if not NAMESPACE_PREFIX.match(prefix):
        raise validation_error(
            {"namespace_prefix": "Use a lowercase letter then up to thirty lowercase letters, digits or underscores."}
        )
    return prefix


def table_names(prefix: str, streams: list[dict[str, Any]]) -> list[str]:
    return [prefix + stream["name"] for stream in streams if stream["selected"]]


async def load_related(
    conn: asyncpg.Connection, workspace_id: uuid.UUID, source_id: str, destination_id: str
) -> tuple[asyncpg.Record, asyncpg.Record]:
    fields: dict[str, str] = {}
    source = destination = None
    if well_formed_id(source_id):
        source = await conn.fetchrow(
            "SELECT * FROM sources WHERE id = $1 AND workspace_id = $2", uuid.UUID(source_id), workspace_id
        )
    if source is None:
        fields["source_id"] = "This source is not in this workspace."
    if well_formed_id(destination_id):
        destination = await conn.fetchrow(
            "SELECT * FROM destinations WHERE id = $1 AND workspace_id = $2",
            uuid.UUID(destination_id),
            workspace_id,
        )
    if destination is None:
        fields["destination_id"] = "This destination is not in this workspace."
    if fields:
        raise validation_error(fields)
    return source, destination


async def lock_workspace_connections(conn: asyncpg.Connection, workspace_id: uuid.UUID) -> None:
    """Connection creations and changes in one workspace are taken one after the other."""
    await conn.execute("SELECT pg_advisory_xact_lock(hashtextextended($1, 2))", str(workspace_id))


async def check_name_free(
    conn: asyncpg.Connection, workspace_id: uuid.UUID, name_key: str, exclude: uuid.UUID | None
) -> None:
    taken = await conn.fetchval(
        """
        SELECT exists (
            SELECT 1 FROM connections
            WHERE workspace_id = $1 AND name_key = $2 AND ($3::uuid IS NULL OR id <> $3)
        )
        """,
        workspace_id,
        name_key,
        exclude,
    )
    if taken:
        raise ApiError("name_taken")


async def check_tables_free(
    conn: asyncpg.Connection,
    destination_id: uuid.UUID,
    wanted: list[str],
    exclude: uuid.UUID | None,
) -> None:
    rows = await conn.fetch(
        """
        SELECT namespace_prefix, streams FROM connections
        WHERE destination_id = $1 AND ($2::uuid IS NULL OR id <> $2)
        """,
        destination_id,
        exclude,
    )
    taken = {
        name
        for row in rows
        for name in table_names(row["namespace_prefix"], row["streams"])
    }
    if taken & set(wanted):
        raise ApiError("table_conflict")


def check_plan_allows(plan: str, schedule: dict[str, Any]) -> None:
    if schedule["type"] == "interval" and not interval_allowed(plan, schedule["interval_minutes"]):
        raise ApiError("frequency_exceeds_plan")
    if schedule["type"] == "cron" and not cron_allowed(plan, parse_cron(schedule["cron_expression"])):
        raise ApiError("frequency_exceeds_plan")


async def next_run_for(
    conn: asyncpg.Connection, connection_id: uuid.UUID, status: str, schedule: dict[str, Any], created_at: datetime
) -> datetime | None:
    last_started_at = await conn.fetchval(
        "SELECT max(started_at) FROM jobs WHERE connection_id = $1", connection_id
    )
    return compute_next_run(status, schedule, created_at, last_started_at)


async def load_connection(
    conn: asyncpg.Connection, connection_id: str, workspace_id: uuid.UUID, *, lock: bool = False
) -> asyncpg.Record:
    if not well_formed_id(connection_id):
        raise ApiError("not_found")
    row = await conn.fetchrow(
        "SELECT * FROM connections WHERE id = $1 AND workspace_id = $2"
        + (" FOR UPDATE" if lock else ""),
        uuid.UUID(connection_id),
        workspace_id,
    )
    if row is None:
        raise ApiError("not_found")
    return row
