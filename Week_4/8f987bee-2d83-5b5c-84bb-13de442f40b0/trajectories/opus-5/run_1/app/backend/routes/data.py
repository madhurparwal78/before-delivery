"""Sources, sample events, destinations and warehouse records."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Request

from .. import warehouse
from ..audit import append_event
from ..context import iso, require_session, require_writer
from ..db import database
from ..errors import ApiError, validation_error
from ..models import DestinationBody, EmptyBody, SampleEventsBody, SourceBody
from ..sample_source import STREAM_NAMES, UPDATABLE_STREAMS
from ..security import protect_secret
from ..sources import check_source, load_source, source_payload, source_streams, validate_config
from ..sync import read_sample_state
from ..validation import FIELD_NAME, parse_body, parse_limit
from .common import ok, path_uuid, raw_body

router = APIRouter()


@router.post("/api/sources")
async def create_source(request: Request) -> Any:
    caller = await require_session(request)
    require_writer(caller)
    body = parse_body(await raw_body(request), SourceBody)
    async with database.transaction() as conn:
        definition = await conn.fetchrow(
            """
            SELECT * FROM connector_definitions
            WHERE id = $1 AND (custom = false OR workspace_id = $2)
            """,
            body.definition_id,
            caller.workspace_id,
        )
        if definition is None or definition["type"] != "source":
            raise validation_error({"definition_id": "This is not a known source connector."})
        config = validate_config(definition, body.config)
        if not definition["runnable"]:
            raise ApiError("connector_not_installed")
        source_id = uuid.uuid4()
        row = await conn.fetchrow(
            """
            INSERT INTO sources (id, workspace_id, name, definition_id, config, api_key_secret, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *
            """,
            source_id,
            caller.workspace_id,
            body.name,
            definition["id"],
            config,
            protect_secret(body.config.api_key),
            datetime.now(timezone.utc),
        )
        await append_event(
            conn,
            workspace_id=caller.workspace_id,
            action="source.created",
            target_id=str(source_id),
            actor_email=caller.email,
        )
    return ok({"source": source_payload(row)}, status=201)


@router.get("/api/sources")
async def list_sources(request: Request) -> Any:
    caller = await require_session(request)
    rows = await database.fetch(
        "SELECT * FROM sources WHERE workspace_id = $1 ORDER BY created_at", caller.workspace_id
    )
    return ok({"sources": [source_payload(row) for row in rows]})


@router.get("/api/sources/{source_id}")
async def read_source(request: Request, source_id: str) -> Any:
    caller = await require_session(request)
    async with database.acquire() as conn:
        source = await load_source(conn, path_uuid(source_id), caller.workspace_id)
    return ok({"source": source_payload(source)})


@router.post("/api/sources/{source_id}/check")
async def check(request: Request, source_id: str) -> Any:
    caller = await require_session(request)
    async with database.acquire() as conn:
        source = await load_source(conn, path_uuid(source_id), caller.workspace_id)
        require_writer(caller)
        parse_body(await raw_body(request), EmptyBody)
        result = await check_source(conn, source)
    return ok(result)


@router.get("/api/sources/{source_id}/catalog")
async def read_source_catalog(request: Request, source_id: str) -> Any:
    caller = await require_session(request)
    async with database.acquire() as conn:
        source = await load_source(conn, path_uuid(source_id), caller.workspace_id)
        streams = await source_streams(conn, source)
    return ok({"streams": streams})


@router.post("/api/sources/{source_id}/sample-events")
async def sample_events(request: Request, source_id: str) -> Any:
    caller = await require_session(request)
    raw = await raw_body(request)
    async with database.transaction() as conn:
        source = await load_source(conn, path_uuid(source_id), caller.workspace_id)
        require_writer(caller)
        definition = await conn.fetchrow(
            "SELECT custom FROM connector_definitions WHERE id = $1", source["definition_id"]
        )
        if definition["custom"]:
            raise ApiError("sample_events_unsupported")
        body = parse_body(raw, SampleEventsBody)
        if body.stream not in STREAM_NAMES:
            raise validation_error({"stream": "This stream is not in the source catalog."})
        chosen = [
            name
            for name, value in (
                ("append", body.append),
                ("update_ids", body.update_ids),
                ("add_field", body.add_field),
            )
            if value is not None
        ]
        if len(chosen) != 1:
            raise validation_error({"body": "Send exactly one of append, update_ids or add_field."})
        now = datetime.now(timezone.utc)
        state = await read_sample_state(conn, source["id"])
        appended = updated = 0
        if body.append is not None:
            next_id = state.next_id(body.stream)
            for offset in range(body.append):
                await conn.execute(
                    """
                    INSERT INTO sample_appended_records (source_id, stream, record_id, updated_at)
                    VALUES ($1, $2, $3, $4)
                    """,
                    source["id"],
                    body.stream,
                    next_id + offset,
                    now,
                )
            appended = body.append
        elif body.update_ids is not None:
            if body.stream not in UPDATABLE_STREAMS:
                raise validation_error({"stream": "Only orders and invoices can be updated."})
            known = set(state.record_ids(body.stream))
            for record_id in body.update_ids:
                if record_id not in known:
                    continue
                await conn.execute(
                    """
                    INSERT INTO sample_record_updates (source_id, stream, record_id, status, updated_at)
                    VALUES ($1, $2, $3, 'refunded', $4)
                    ON CONFLICT (source_id, stream, record_id)
                        DO UPDATE SET status = 'refunded', updated_at = $4
                    """,
                    source["id"],
                    body.stream,
                    record_id,
                    now,
                )
                updated += 1
        else:
            if not FIELD_NAME.match(body.add_field):
                raise validation_error(
                    {"add_field": "Use a lowercase letter then up to thirty lowercase letters, digits or underscores."}
                )
            await conn.execute(
                """
                INSERT INTO sample_added_fields (source_id, stream, field) VALUES ($1, $2, $3)
                ON CONFLICT (source_id, stream, field) DO NOTHING
                """,
                source["id"],
                body.stream,
                body.add_field,
            )
        fields = (await read_sample_state(conn, source["id"])).fields_of(body.stream)
    return ok({"stream": body.stream, "appended": appended, "updated": updated, "fields": fields})


@router.post("/api/destinations")
async def create_destination(request: Request) -> Any:
    caller = await require_session(request)
    require_writer(caller)
    body = parse_body(await raw_body(request), DestinationBody)
    async with database.transaction() as conn:
        definition = await conn.fetchrow(
            "SELECT * FROM connector_definitions WHERE id = $1 AND custom = false", body.definition_id
        )
        if definition is None or definition["type"] != "destination":
            raise validation_error({"definition_id": "This is not a known destination connector."})
        if not definition["runnable"]:
            raise ApiError("connector_not_installed")
        destination_id = uuid.uuid4()
        row = await conn.fetchrow(
            """
            INSERT INTO destinations (id, workspace_id, name, definition_id, created_at)
            VALUES ($1, $2, $3, $4, $5) RETURNING *
            """,
            destination_id,
            caller.workspace_id,
            body.name,
            definition["id"],
            datetime.now(timezone.utc),
        )
        await append_event(
            conn,
            workspace_id=caller.workspace_id,
            action="destination.created",
            target_id=str(destination_id),
            actor_email=caller.email,
        )
    return ok({"destination": _destination_payload(row)}, status=201)


@router.get("/api/destinations")
async def list_destinations(request: Request) -> Any:
    caller = await require_session(request)
    rows = await database.fetch(
        "SELECT * FROM destinations WHERE workspace_id = $1 ORDER BY created_at", caller.workspace_id
    )
    return ok({"destinations": [_destination_payload(row) for row in rows]})


def _destination_payload(row: Any) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "name": row["name"],
        "definition_id": row["definition_id"],
        "created_at": iso(row["created_at"]),
    }


async def _load_destination(conn: Any, destination_id: str, workspace_id: uuid.UUID) -> Any:
    row = await conn.fetchrow(
        "SELECT * FROM destinations WHERE id = $1 AND workspace_id = $2",
        path_uuid(destination_id),
        workspace_id,
    )
    if row is None:
        raise ApiError("not_found")
    return row


@router.get("/api/destinations/{destination_id}/tables")
async def list_tables(request: Request, destination_id: str) -> Any:
    caller = await require_session(request)
    async with database.acquire() as conn:
        destination = await _load_destination(conn, destination_id, caller.workspace_id)
        tables = await warehouse.list_tables(conn, destination["id"])
    return ok({"tables": tables})


@router.get("/api/destinations/{destination_id}/tables/{table}/records")
async def list_records(request: Request, destination_id: str, table: str) -> Any:
    caller = await require_session(request)
    limit = parse_limit(request.query_params.get("limit"), 50)
    cursor = request.query_params.get("cursor")
    async with database.acquire() as conn:
        destination = await _load_destination(conn, destination_id, caller.workspace_id)
        registration = await warehouse.table_registration(conn, destination["id"], table)
        if registration is None:
            raise ApiError("not_found")
        payload = await warehouse.read_records(
            conn,
            destination["id"],
            table,
            list(registration["fields"]),
            registration["generation"],
            limit,
            cursor,
        )
    return ok(payload)
