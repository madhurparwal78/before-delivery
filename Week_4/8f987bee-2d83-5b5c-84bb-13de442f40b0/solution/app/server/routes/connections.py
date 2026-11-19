"""Connections: create, read, the versioned PATCH, state, reset and Sync now."""

import uuid

from fastapi import APIRouter, Depends, Request, Response

from .. import audit, idempotency, jobs, lifecycle, sync, warehouse
from .. import schedule as schedules
from ..auth import Member, current_member
from ..connections import (CONNECTION_VIEW, ConnectionIn, ConnectionPatch, check_conflicts, from_view,
                           lock_workspace, stored_streams, streams_errors, validated, view)
from ..db import db, utcnow
from ..errors import ApiError, validation
from ..inputs import Body, name_error, raw_json, shape_errors
from ..objects import owned
from ..sources import published_version, stream_catalog
from ..views import ConnectionOut, Connections, JobOut, State

router = APIRouter()


def _etag(response: Response, connection: dict) -> dict:
    response.headers["ETag"] = f'"{connection["version"]}"'
    return {"connection": connection}


@router.get("/api/connections", response_model=Connections)
async def connections(member: Member = Depends(current_member)) -> dict:
    async with db.snapshot() as conn:
        rows = await conn.fetch(CONNECTION_VIEW + " WHERE c.workspace_id = $1 ORDER BY c.created_at, c.name",
                                member.workspace_id)
    return {"connections": [from_view(row) for row in rows]}


@router.post("/api/connections", status_code=201, response_model=ConnectionOut)
async def create(request: Request, response: Response, member: Member = Depends(current_member)) -> dict:
    member.require("editor")
    raw = raw_json(request)
    key = idempotency.key_of(request)
    request_print = idempotency.fingerprint("POST", request.url.path, raw)
    async with db.transaction() as conn:
        if key and (replay := await idempotency.replayed(conn, member.workspace_id, key, request_print)):
            response.status_code = 200
            return {"connection": await view(conn, replay)}
        body, fields = shape_errors(ConnectionIn, raw)
        if fields:
            raise validation(fields)
        data = await validated(conn, member.workspace_id, body)
        await lock_workspace(conn, member.workspace_id)
        await check_conflicts(conn, member.workspace_id, name=data["name"], destination_id=data["destination_id"],
                              prefix=data["namespace_prefix"], streams=data["streams"], schedule=data["schedule"])
        connection_id = uuid.uuid4()
        await conn.execute(
            """INSERT INTO connections (id, workspace_id, name, status, version, source_id, destination_id,
                                        namespace_prefix, streams, schedule, schema_change_policy, cursors, created_at)
               VALUES ($1, $2, $3, 'active', 1, $4, $5, $6, $7, $8, $9, $10, $11)""",
            connection_id, member.workspace_id, data["name"], data["source"]["id"], data["destination_id"],
            data["namespace_prefix"], data["streams"], data["schedule"], data["schema_change_policy"],
            {stream["name"]: None for stream in data["streams"]}, utcnow())
        await audit.append(conn, member.workspace_id, "connection.created", connection_id, member.email)
        if key:
            await idempotency.record(conn, member.workspace_id, key, request_print, "connection", connection_id)
        return {"connection": await view(conn, connection_id)}


@router.get("/api/connections/{connection_id}", response_model=ConnectionOut)
async def connection(connection_id: str, response: Response, member: Member = Depends(current_member)) -> dict:
    async with db.snapshot() as conn:
        row = await owned(conn, "connection", connection_id, member.workspace_id)
        return _etag(response, await view(conn, row["id"]))


@router.patch("/api/connections/{connection_id}", response_model=ConnectionOut)
async def change(connection_id: str, request: Request, response: Response,
                 member: Member = Depends(current_member)) -> dict:
    async with db.snapshot() as conn:
        await owned(conn, "connection", connection_id, member.workspace_id)
    member.require("editor")
    if_match = request.headers.get("if-match")
    if if_match is None:
        raise ApiError(428, "precondition_required")
    async with db.transaction() as conn:
        row = await owned(conn, "connection", connection_id, member.workspace_id, lock=True)
        if if_match.strip() != f'"{row["version"]}"':
            raise ApiError(412, "version_mismatch", extra={"current_version": row["version"]})
        body, fields = shape_errors(ConnectionPatch, raw_json(request))
        if fields:
            raise validation(fields)
        sent = body.model_fields_set
        source = await conn.fetchrow("SELECT * FROM sources WHERE id = $1", row["source_id"])
        catalog = await stream_catalog(conn, source)
        errors: dict[str, str] = {}
        for name in sent:
            if getattr(body, name) is None:
                errors[name] = "This field cannot be empty."
        if body.name is not None and (message := name_error(body.name)):
            errors["name"] = message
        if body.streams is not None:
            errors |= streams_errors(body.streams, catalog)
        schedule = row["schedule"]
        if body.schedule is not None:
            schedule, schedule_errors = schedules.normalize(body.schedule)
            errors |= schedule_errors
        if errors:
            raise validation(errors)
        name = body.name.strip() if body.name is not None else row["name"]
        streams = stored_streams(body.streams, catalog, row["streams"]) if body.streams is not None else row["streams"]
        status = body.status or row["status"]
        reactivated = row["status"] == "inactive" and status == "active" and row["schema_paused"]
        if reactivated:
            fields_now = {entry["name"]: entry["fields"] for entry in catalog}
            streams = [{**stream, "known_fields": list(fields_now[stream["name"]])} for stream in streams]
        await lock_workspace(conn, member.workspace_id)
        await check_conflicts(conn, member.workspace_id, name=name, destination_id=row["destination_id"],
                              prefix=row["namespace_prefix"], streams=streams,
                              schedule=schedule if body.schedule is not None else None, exclude=row["id"])
        await conn.execute(
            """UPDATE connections SET name = $2, streams = $3, schedule = $4, schema_change_policy = $5, status = $6,
                      schema_paused = schema_paused AND NOT $7 AND $6 = 'inactive', version = version + 1
               WHERE id = $1""",
            row["id"], name, streams, schedule, body.schema_change_policy or row["schema_change_policy"], status,
            reactivated)
        await audit.append(conn, member.workspace_id, "connection.updated", row["id"], member.email)
        return _etag(response, await view(conn, row["id"]))


@router.get("/api/connections/{connection_id}/state", response_model=State)
async def state(connection_id: str, member: Member = Depends(current_member)) -> dict:
    async with db.snapshot() as conn:
        row = await owned(conn, "connection", connection_id, member.workspace_id)
    return {"streams": [{"name": stream["name"], "cursor_field": stream["cursor_field"],
                         "cursor_value": row["cursors"].get(stream["name"])} for stream in row["streams"]]}


@router.post("/api/connections/{connection_id}/reset", response_model=ConnectionOut)
async def reset(connection_id: str, request: Request, member: Member = Depends(current_member)) -> dict:
    async with db.snapshot() as conn:
        await owned(conn, "connection", connection_id, member.workspace_id)
    member.require("editor")
    _, fields = shape_errors(Body, raw_json(request))
    if fields:
        raise validation(fields)
    async with db.transaction() as conn:
        row = await owned(conn, "connection", connection_id, member.workspace_id, lock=True)
        if await lifecycle.has_active(conn, row["id"]):
            raise ApiError(409, "sync_already_running")
        await warehouse.reset(conn, row["id"])
        await conn.execute("UPDATE connections SET cursors = $2 WHERE id = $1", row["id"],
                           {stream["name"]: None for stream in row["streams"]})
        await audit.append(conn, member.workspace_id, "connection.reset", row["id"], member.email)
        return {"connection": await view(conn, row["id"])}


@router.post("/api/connections/{connection_id}/sync", status_code=201, response_model=JobOut)
async def sync_now(connection_id: str, request: Request, response: Response,
                   member: Member = Depends(current_member)) -> dict:
    async with db.snapshot() as conn:
        await owned(conn, "connection", connection_id, member.workspace_id)
    member.require("editor")
    raw = raw_json(request)
    key = idempotency.key_of(request)
    request_print = idempotency.fingerprint("POST", request.url.path, raw)
    async with db.transaction() as conn:
        if key and (replay := await idempotency.replayed(conn, member.workspace_id, key, request_print)):
            response.status_code = 200
            return {"job": jobs.public(await conn.fetchrow("SELECT * FROM jobs WHERE id = $1", replay))}
        _, fields = shape_errors(Body, raw)
        if fields:
            raise validation(fields)
        row = await owned(conn, "connection", connection_id, member.workspace_id, lock=True)
        if row["status"] != "active":
            raise ApiError(409, "connection_inactive")
        if await lifecycle.has_active(conn, row["id"]):
            raise ApiError(409, "sync_already_running")
        source = await conn.fetchrow("SELECT id, definition_id FROM sources WHERE id = $1", row["source_id"])
        definition = await conn.fetchrow("SELECT * FROM connector_definitions WHERE id = $1", source["definition_id"])
        settings = {
            "source_id": str(source["id"]), "definition_id": definition["id"],
            "destination_id": str(row["destination_id"]), "namespace_prefix": row["namespace_prefix"],
            "schema_change_policy": row["schema_change_policy"],
            "streams": [stream for stream in row["streams"] if stream["selected"]],
            "published": published_version(definition) if definition["custom"] else None,
        }
        job_id = await lifecycle.create(conn, workspace_id=member.workspace_id, connection_id=row["id"],
                                        connection_version=row["version"], definition_version=definition["version"],
                                        settings=settings, request_id=request.scope["wayline.request_id"],
                                        member_id=member.id, member_email=member.email)
        if key:
            await idempotency.record(conn, member.workspace_id, key, request_print, "job", job_id)
        job = jobs.public(await conn.fetchrow("SELECT * FROM jobs WHERE id = $1", job_id))
    sync.launch(job_id)
    return {"job": job}
