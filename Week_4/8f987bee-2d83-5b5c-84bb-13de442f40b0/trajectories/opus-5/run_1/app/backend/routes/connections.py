"""Connections: creating them, changing them at a version, resetting them and starting syncs."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Request

from .. import warehouse
from ..audit import append_event
from ..connections import (
    check_name_free,
    check_plan_allows,
    check_tables_free,
    connection_payload,
    load_connection,
    load_related,
    lock_workspace_connections,
    next_run_for,
    normalized_schedule,
    table_names,
    validate_prefix,
    validate_streams,
)
from ..context import require_session, require_writer
from ..db import database
from ..errors import ApiError
from ..models import ConnectionBody, ConnectionPatchBody, EmptyBody
from ..scheduling import compute_next_run
from ..sources import source_streams
from ..sync import ACTIVE_STATUSES, create_job, job_payload
from ..validation import parse_body, read_idempotency_key, read_json_object
from .common import ok, raw_body
from .idempotent import replay_connection, replay_job, run_with_key

router = APIRouter()


@router.post("/api/connections")
async def create_connection(request: Request) -> Any:
    caller = await require_session(request)
    require_writer(caller)
    raw = await raw_body(request)
    key = read_idempotency_key(request.headers.get("idempotency-key"))

    async def create() -> tuple[dict[str, Any], str]:
        body = parse_body(raw, ConnectionBody)
        async with database.transaction() as conn:
            await lock_workspace_connections(conn, caller.workspace_id)
            source, destination = await load_related(
                conn, caller.workspace_id, body.source_id, body.destination_id
            )
            definition = await conn.fetchrow(
                "SELECT custom FROM connector_definitions WHERE id = $1", source["definition_id"]
            )
            catalog = await source_streams(conn, source)
            streams = validate_streams(body.streams, catalog, definition["custom"])
            prefix = validate_prefix(body.namespace_prefix)
            schedule = normalized_schedule(body.schedule)
            name = body.name.strip()
            await check_name_free(conn, caller.workspace_id, name.casefold(), None)
            await check_tables_free(conn, destination["id"], table_names(prefix, streams), None)
            plan = await conn.fetchval("SELECT plan FROM workspaces WHERE id = $1", caller.workspace_id)
            check_plan_allows(plan, schedule)
            connection_id = uuid.uuid4()
            created_at = datetime.now(timezone.utc)
            row = await conn.fetchrow(
                """
                INSERT INTO connections (
                    id, workspace_id, name, name_key, status, version, source_id, destination_id,
                    namespace_prefix, streams, schedule, schema_change_policy, cursors, created_at, next_run_at
                )
                VALUES ($1, $2, $3, $4, 'active', 1, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                RETURNING *
                """,
                connection_id,
                caller.workspace_id,
                name,
                name.casefold(),
                source["id"],
                destination["id"],
                prefix,
                streams,
                schedule,
                body.schema_change_policy,
                {stream["name"]: None for stream in streams},
                created_at,
                compute_next_run("active", schedule, created_at, None),
            )
            await append_event(
                conn,
                workspace_id=caller.workspace_id,
                action="connection.created",
                target_id=str(connection_id),
                actor_email=caller.email,
            )
        return {"connection": connection_payload(row)}, str(connection_id)

    payload, status = await run_with_key(
        caller,
        key,
        request,
        raw,
        resource_kind="connection",
        create=create,
        replay=replay_connection,
        success_status=201,
    )
    return ok(payload, status=status)


@router.get("/api/connections")
async def list_connections(request: Request) -> Any:
    caller = await require_session(request)
    rows = await database.fetch(
        "SELECT * FROM connections WHERE workspace_id = $1 ORDER BY created_at", caller.workspace_id
    )
    return ok({"connections": [connection_payload(row) for row in rows]})


@router.get("/api/connections/{connection_id}")
async def read_connection(request: Request, connection_id: str) -> Any:
    caller = await require_session(request)
    async with database.acquire() as conn:
        row = await load_connection(conn, connection_id, caller.workspace_id)
    return ok({"connection": connection_payload(row)}, headers={"ETag": f'"{row["version"]}"'})


@router.patch("/api/connections/{connection_id}")
async def change_connection(request: Request, connection_id: str) -> Any:
    caller = await require_session(request)
    async with database.acquire() as conn:
        stored = await load_connection(conn, connection_id, caller.workspace_id)
    require_writer(caller)
    if_match = request.headers.get("if-match")
    if if_match is None:
        raise ApiError("precondition_required")
    raw = await raw_body(request)
    async with database.transaction() as conn:
        await lock_workspace_connections(conn, caller.workspace_id)
        current = await load_connection(conn, connection_id, caller.workspace_id, lock=True)
        if if_match != f'"{current["version"]}"':
            raise ApiError("version_mismatch", extra={"current_version": current["version"]})
        body = parse_body(raw, ConnectionPatchBody)
        source = await conn.fetchrow("SELECT * FROM sources WHERE id = $1", current["source_id"])
        definition = await conn.fetchrow(
            "SELECT custom FROM connector_definitions WHERE id = $1", source["definition_id"]
        )
        catalog = await source_streams(conn, source)
        name = current["name"] if body.name is None else body.name.strip()
        status = current["status"] if body.status is None else body.status
        policy = (
            current["schema_change_policy"]
            if body.schema_change_policy is None
            else body.schema_change_policy
        )
        schedule = current["schedule"] if body.schedule is None else normalized_schedule(body.schedule)
        if body.streams is not None:
            streams = validate_streams(body.streams, catalog, definition["custom"])
        elif status == "active" and current["status"] == "inactive":
            streams = _adopt_fields(current["streams"], catalog)
        else:
            streams = current["streams"]
        if body.name is not None:
            await check_name_free(conn, caller.workspace_id, name.casefold(), current["id"])
        if body.streams is not None:
            await check_tables_free(
                conn,
                current["destination_id"],
                table_names(current["namespace_prefix"], streams),
                current["id"],
            )
        if body.schedule is not None:
            plan = await conn.fetchval("SELECT plan FROM workspaces WHERE id = $1", caller.workspace_id)
            check_plan_allows(plan, schedule)
        next_run_at = await next_run_for(
            conn, current["id"], status, schedule, current["created_at"]
        )
        row = await conn.fetchrow(
            """
            UPDATE connections SET name = $2, name_key = $3, status = $4, streams = $5, schedule = $6,
                schema_change_policy = $7, version = version + 1, next_run_at = $8
            WHERE id = $1 RETURNING *
            """,
            current["id"],
            name,
            name.casefold(),
            status,
            streams,
            schedule,
            policy,
            next_run_at,
        )
        await append_event(
            conn,
            workspace_id=caller.workspace_id,
            action="connection.updated",
            target_id=str(current["id"]),
            actor_email=caller.email,
        )
    return ok({"connection": connection_payload(row)}, headers={"ETag": f'"{row["version"]}"'})


def _adopt_fields(streams: list[dict[str, Any]], catalog: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Reactivating a connection adopts each stream's fields as they stand."""
    fields = {stream["name"]: list(stream["fields"]) for stream in catalog}
    return [{**stream, "known_fields": fields[stream["name"]]} for stream in streams]


@router.get("/api/connections/{connection_id}/state")
async def read_state(request: Request, connection_id: str) -> Any:
    caller = await require_session(request)
    async with database.acquire() as conn:
        row = await load_connection(conn, connection_id, caller.workspace_id)
    return ok(
        {
            "streams": [
                {
                    "name": stream["name"],
                    "cursor_field": stream["cursor_field"],
                    "cursor_value": row["cursors"].get(stream["name"]),
                }
                for stream in row["streams"]
            ]
        }
    )


@router.post("/api/connections/{connection_id}/reset")
async def reset_connection(request: Request, connection_id: str) -> Any:
    caller = await require_session(request)
    async with database.acquire() as conn:
        await load_connection(conn, connection_id, caller.workspace_id)
    require_writer(caller)
    parse_body(await raw_body(request), EmptyBody)
    async with database.transaction() as conn:
        current = await load_connection(conn, connection_id, caller.workspace_id, lock=True)
        active = await conn.fetchval(
            "SELECT exists (SELECT 1 FROM jobs WHERE connection_id = $1 AND status = ANY($2::text[]))",
            current["id"],
            list(ACTIVE_STATUSES),
        )
        if active:
            raise ApiError("sync_already_running")
        tables = await conn.fetch(
            "SELECT name FROM warehouse_tables WHERE destination_id = $1 AND connection_id = $2",
            current["destination_id"],
            current["id"],
        )
        for table in tables:
            await warehouse.delete_rows(conn, current["destination_id"], table["name"])
        await conn.execute(
            """
            UPDATE warehouse_tables SET generation = generation + 1
            WHERE destination_id = $1 AND connection_id = $2
            """,
            current["destination_id"],
            current["id"],
        )
        row = await conn.fetchrow(
            "UPDATE connections SET cursors = $2 WHERE id = $1 RETURNING *",
            current["id"],
            {stream["name"]: None for stream in current["streams"]},
        )
        await append_event(
            conn,
            workspace_id=caller.workspace_id,
            action="connection.reset",
            target_id=str(current["id"]),
            actor_email=caller.email,
        )
    return ok({"connection": connection_payload(row)})


@router.post("/api/connections/{connection_id}/sync")
async def start_sync(request: Request, connection_id: str) -> Any:
    caller = await require_session(request)
    async with database.acquire() as conn:
        stored = await load_connection(conn, connection_id, caller.workspace_id)
    require_writer(caller)
    raw = await raw_body(request)
    key = read_idempotency_key(request.headers.get("idempotency-key"))

    async def create() -> tuple[dict[str, Any], str]:
        parse_body(raw, EmptyBody)
        job = await create_job(
            stored["id"],
            caller.workspace_id,
            caller.user_id,
            caller.email,
            request.state.request_id,
        )
        return {"job": job}, job["id"]

    payload, status = await run_with_key(
        caller,
        key,
        request,
        raw,
        resource_kind="job",
        create=create,
        replay=replay_job,
        success_status=201,
    )
    return ok(payload, status=status)


__all__ = ["router", "job_payload", "read_json_object"]
