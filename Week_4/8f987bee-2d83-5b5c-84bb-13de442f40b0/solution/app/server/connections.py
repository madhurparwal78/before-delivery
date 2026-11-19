"""Connections: the accepted body, its validation, the creation conflicts and the version check."""

import re
import uuid
from typing import Any, Literal

import asyncpg

from . import schedule as schedules
from .db import iso
from .errors import ApiError, validation
from .inputs import Body, name_error
from .objects import parse_id
from .sources import source_in, stream_catalog

PREFIX = re.compile(r"[a-z][a-z0-9_]{0,30}")
INCREMENTAL = ("incremental_append", "incremental_dedup")
SyncMode = Literal["full_refresh_overwrite", "full_refresh_append", "incremental_append", "incremental_dedup"]
Policy = Literal["propagate", "ignore", "pause"]


class StreamIn(Body):
    name: str
    selected: bool
    sync_mode: SyncMode
    cursor_field: str | None
    primary_key: list[str] | None


class ConnectionIn(Body):
    name: str
    source_id: str
    destination_id: str
    namespace_prefix: str
    streams: list[StreamIn]
    schedule: schedules.ScheduleIn
    schema_change_policy: Policy


class ConnectionPatch(Body):
    name: str | None = None
    streams: list[StreamIn] | None = None
    schedule: schedules.ScheduleIn | None = None
    schema_change_policy: Policy | None = None
    status: Literal["active", "inactive"] | None = None


def streams_errors(streams: list[StreamIn], catalog: list[dict[str, Any]]) -> dict[str, str]:
    errors: dict[str, str] = {}
    by_name = {entry["name"]: entry for entry in catalog}
    seen: set[str] = set()
    for index, stream in enumerate(streams):
        entry = by_name.get(stream.name)
        if entry is None or stream.name in seen:
            errors[f"streams.{index}.name"] = "Choose each stream the source offers once."
            continue
        seen.add(stream.name)
        if stream.sync_mode not in entry["supported_sync_modes"]:
            errors[f"streams.{index}.sync_mode"] = "This stream does not support that sync mode."
        elif stream.sync_mode in INCREMENTAL and stream.cursor_field != entry["cursor_field"]:
            errors[f"streams.{index}.cursor_field"] = "Incremental modes need the updated_at cursor."
        elif stream.sync_mode == "incremental_dedup" and stream.primary_key != ["id"]:
            errors[f"streams.{index}.primary_key"] = "Incremental dedup needs the id primary key."
    if not errors and seen != set(by_name):
        errors["streams"] = "List every stream the source offers."
    elif not errors and not any(stream.selected for stream in streams):
        errors["streams"] = "Select at least one stream."
    return errors


def stored_streams(streams: list[StreamIn], catalog: list[dict[str, Any]],
                   previous: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    """Streams in catalog order, each with its known schema: kept from before, or the fields it has now."""
    sent = {stream.name: stream for stream in streams}
    kept = {stream["name"]: stream["known_fields"] for stream in previous or []}
    return [{"name": entry["name"], "selected": sent[entry["name"]].selected,
             "sync_mode": sent[entry["name"]].sync_mode, "cursor_field": sent[entry["name"]].cursor_field,
             "primary_key": sent[entry["name"]].primary_key,
             "known_fields": kept.get(entry["name"], list(entry["fields"]))} for entry in catalog]


def table_names(prefix: str, streams: list[dict[str, Any]]) -> set[str]:
    return {prefix + stream["name"] for stream in streams if stream["selected"]}


async def validated(conn: asyncpg.Connection, workspace_id: uuid.UUID, body: ConnectionIn) -> dict[str, Any]:
    errors: dict[str, str] = {}
    if message := name_error(body.name):
        errors["name"] = message
    source_id, destination_id = parse_id(body.source_id), parse_id(body.destination_id)
    source = await source_in(conn, workspace_id, source_id) if source_id else None
    if source is None:
        errors["source_id"] = "Choose a source from this workspace."
    destination = None
    if destination_id:
        destination = await conn.fetchrow("SELECT id FROM destinations WHERE id = $1 AND workspace_id = $2",
                                          destination_id, workspace_id)
    if destination is None:
        errors["destination_id"] = "Choose a destination from this workspace."
    if not PREFIX.fullmatch(body.namespace_prefix):
        errors["namespace_prefix"] = "Start with a lowercase letter; use up to 31 lowercase letters, digits or _."
    catalog = await stream_catalog(conn, source) if source else []
    if source:
        errors |= streams_errors(body.streams, catalog)
    stored_schedule, schedule_errors = schedules.normalize(body.schedule)
    errors |= schedule_errors
    if errors:
        raise validation(errors)
    return {"name": body.name.strip(), "source": source, "destination_id": destination_id,
            "namespace_prefix": body.namespace_prefix, "streams": stored_streams(body.streams, catalog),
            "schedule": stored_schedule, "schema_change_policy": body.schema_change_policy}


async def check_conflicts(conn: asyncpg.Connection, workspace_id: uuid.UUID, *, name: str,
                          destination_id: uuid.UUID, prefix: str, streams: list[dict[str, Any]],
                          schedule: dict[str, Any] | None, exclude: uuid.UUID | None = None) -> None:
    """The creation conflicts in order: name_taken, table_conflict, frequency_exceeds_plan. The caller holds the
    workspace row lock, so simultaneous creations are checked one after another."""
    others = await conn.fetch("SELECT id, name, destination_id, namespace_prefix, streams FROM connections "
                              "WHERE workspace_id = $1 AND id IS DISTINCT FROM $2", workspace_id, exclude)
    if any(other["name"].strip().lower() == name.lower() for other in others):
        raise ApiError(409, "name_taken")
    wanted = table_names(prefix, streams)
    for other in others:
        if other["destination_id"] == destination_id:
            taken = wanted & table_names(other["namespace_prefix"], other["streams"])
            if taken:
                raise ApiError(409, "table_conflict", extra={"table": sorted(taken)[0]})
    plan = await conn.fetchval("SELECT plan FROM workspaces WHERE id = $1", workspace_id)
    if schedule is not None and schedules.exceeds_plan(schedule, plan):
        raise ApiError(422, "frequency_exceeds_plan")


async def lock_workspace(conn: asyncpg.Connection, workspace_id: uuid.UUID) -> None:
    await conn.execute("SELECT 1 FROM workspaces WHERE id = $1 FOR NO KEY UPDATE", workspace_id)


def public(row: asyncpg.Record, last_started_at=None, last_job_status: str | None = None) -> dict[str, Any]:
    next_run = schedules.next_run_at(row["schedule"], row["status"], row["created_at"], last_started_at)
    return {
        "id": str(row["id"]), "workspace_id": str(row["workspace_id"]), "name": row["name"],
        "source_id": str(row["source_id"]), "destination_id": str(row["destination_id"]),
        "namespace_prefix": row["namespace_prefix"], "streams": row["streams"], "schedule": row["schedule"],
        "schema_change_policy": row["schema_change_policy"], "status": row["status"], "version": row["version"],
        "created_at": iso(row["created_at"]), "next_run_at": iso(next_run), "last_job_status": last_job_status,
    }


CONNECTION_VIEW = """
    SELECT c.*, (SELECT max(started_at) FROM jobs j WHERE j.connection_id = c.id) AS last_started_at,
           (SELECT status FROM jobs j WHERE j.connection_id = c.id ORDER BY created_at DESC, id DESC LIMIT 1)
               AS last_job_status
    FROM connections c
"""


def from_view(row: asyncpg.Record) -> dict[str, Any]:
    return public(row, row["last_started_at"], row["last_job_status"])


async def view(conn: asyncpg.Connection, connection_id: uuid.UUID) -> dict[str, Any]:
    return from_view(await conn.fetchrow(CONNECTION_VIEW + " WHERE c.id = $1", connection_id))
