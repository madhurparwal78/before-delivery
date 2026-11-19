"""The connector catalog, sources, destinations and warehouse tables."""

import asyncio
import re
import uuid
from typing import Any

from fastapi import APIRouter, Depends, Request

from .. import audit, builder, catalog, paging, sample, warehouse
from ..auth import Member, bearer, current_member, member_for_token
from ..db import db, iso, utcnow
from ..errors import ApiError, not_found, validation
from ..inputs import Body, name_error, parse
from ..objects import owned
from ..sealing import seal, unseal
from ..sources import config_errors, public, published_version, stream_catalog
from ..views import (Catalog, Check, DefinitionOut, Definitions, DestinationOut, Destinations, Records, SampleEvent,
                     SourceOut, Sources, Tables)

router = APIRouter()
FIELD_NAME = re.compile(r"[a-z][a-z0-9_]{0,30}")
APPEND_MAX = 500
REJECTED = "The source rejected the API key."
DEFINITION_ID_MAX = 200


def _plausible_id(definition_id: str) -> bool:
    """Postgres text refuses NUL bytes, so such an id (or an absurdly long one) is unknown before any lookup."""
    return "\x00" not in definition_id and len(definition_id) <= DEFINITION_ID_MAX


class SourceIn(Body):
    name: str
    definition_id: str
    config: dict[str, Any]


class DestinationIn(Body):
    name: str
    definition_id: str


class SampleEventIn(Body):
    stream: str
    append: int | None = None
    update_ids: list[int] | None = None
    add_field: str | None = None


async def _signed_in_workspace(request: Request) -> uuid.UUID | None:
    """The public catalog adds the caller's custom definitions when a valid session is sent."""
    token = bearer(request)
    if token is None:
        return None
    try:
        return (await member_for_token(token)).workspace_id
    except ApiError:
        return None


@router.get("/api/connector-definitions", response_model=Definitions)
async def definitions(request: Request) -> dict:
    chosen = catalog.filters(request.query_params)
    workspace_id = await _signed_in_workspace(request)
    async with db.snapshot() as conn:
        rows = await conn.fetch("SELECT * FROM connector_definitions WHERE NOT custom OR workspace_id = $1 "
                                "ORDER BY custom, created_at, name", workspace_id)
    listed = [catalog.public(row) for row in rows]
    return {"definitions": [d for d in listed if catalog.keep(d, chosen)]}


@router.get("/api/connector-definitions/{definition_id}", response_model=DefinitionOut)
async def definition(definition_id: str, request: Request) -> dict:
    workspace_id = await _signed_in_workspace(request)
    if not _plausible_id(definition_id):
        raise not_found()
    async with db.snapshot() as conn:
        row = await conn.fetchrow("SELECT * FROM connector_definitions WHERE id = $1 AND (NOT custom OR workspace_id = $2)",
                                  definition_id, workspace_id)
    if row is None:
        raise not_found()
    return {"definition": catalog.public(row)}


def _name_error(name: str) -> dict[str, str]:
    message = name_error(name)
    return {"name": message} if message else {}


async def _definition_for(conn, member: Member, definition_id: str, kind: str):
    if not _plausible_id(definition_id):
        return None
    return await conn.fetchrow("SELECT * FROM connector_definitions WHERE id = $1 AND type = $2 "
                               "AND (NOT custom OR workspace_id = $3)", definition_id, kind, member.workspace_id)


@router.get("/api/sources", response_model=Sources)
async def sources(member: Member = Depends(current_member)) -> dict:
    async with db.snapshot() as conn:
        rows = await conn.fetch("SELECT * FROM sources WHERE workspace_id = $1 ORDER BY created_at, name",
                                member.workspace_id)
    return {"sources": [public(row) for row in rows]}


@router.post("/api/sources", status_code=201, response_model=SourceOut)
async def create_source(request: Request, member: Member = Depends(current_member)) -> dict:
    member.require("editor")
    body = parse(request, SourceIn)
    async with db.transaction() as conn:
        definition = await _definition_for(conn, member, body.definition_id, "source")
        errors = _name_error(body.name)
        if definition is None:
            errors["definition_id"] = "Choose a source connector from the catalog."
        else:
            errors |= config_errors(definition, body.config)
        if errors:
            raise validation(errors)
        if not definition["runnable"]:
            raise ApiError(422, "connector_not_installed")
        config = {key: value for key, value in body.config.items() if key != "api_key"}
        row = await conn.fetchrow(
            "INSERT INTO sources (id, workspace_id, name, definition_id, config, sealed_api_key, created_at) "
            "VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *", uuid.uuid4(), member.workspace_id, body.name,
            definition["id"], config, seal(body.config["api_key"]), utcnow())
        await audit.append(conn, member.workspace_id, "source.created", row["id"], member.email)
    return {"source": public(row)}


@router.get("/api/sources/{source_id}", response_model=SourceOut)
async def source(source_id: str, member: Member = Depends(current_member)) -> dict:
    async with db.snapshot() as conn:
        return {"source": public(await owned(conn, "source", source_id, member.workspace_id))}


@router.post("/api/sources/{source_id}/check", response_model=Check, response_model_exclude_none=True)
async def check_source(source_id: str, request: Request, member: Member = Depends(current_member)) -> dict:
    async with db.snapshot() as conn:
        row = await owned(conn, "source", source_id, member.workspace_id)
        definition = await conn.fetchrow("SELECT * FROM connector_definitions WHERE id = $1", row["definition_id"])
    member.require("editor")
    parse(request, Body)
    api_key = unseal(bytes(row["sealed_api_key"]))
    if definition["custom"]:
        manifest = published_version(definition)["manifest"]
        result = await asyncio.to_thread(builder.read_stream, manifest, manifest["streams"][0]["name"], api_key)
        rejected = result.http_status is not None
    else:
        rejected = sample.key_rejected(api_key)
    return {"status": "failed", "message": REJECTED} if rejected else {"status": "succeeded"}


@router.get("/api/sources/{source_id}/catalog", response_model=Catalog)
async def source_catalog(source_id: str, member: Member = Depends(current_member)) -> dict:
    async with db.snapshot() as conn:
        row = await owned(conn, "source", source_id, member.workspace_id)
        return {"streams": await stream_catalog(conn, row)}


@router.post("/api/sources/{source_id}/sample-events", response_model=SampleEvent)
async def sample_events(source_id: str, request: Request, member: Member = Depends(current_member)) -> dict:
    async with db.snapshot() as conn:
        row = await owned(conn, "source", source_id, member.workspace_id)
    member.require("editor")
    body = parse(request, SampleEventIn)
    changes = [name for name in ("append", "update_ids", "add_field") if getattr(body, name) is not None]
    errors: dict[str, str] = {}
    if len(changes) != 1:
        for name in changes[1:] or ["append"]:
            errors[name] = "Send exactly one of append, update_ids or add_field."
    if body.stream not in sample.STREAMS:
        errors["stream"] = "Choose customers, orders or invoices."
    if body.append is not None and not 1 <= body.append <= APPEND_MAX:
        errors["append"] = "Append from 1 to 500 records."
    if body.update_ids is not None and body.stream == "customers":
        errors["update_ids"] = "Only orders and invoices can be refunded."
    if errors:
        raise validation(errors)
    if row["definition_id"] != catalog.SAMPLE_DEFINITION:
        raise ApiError(422, "sample_events_unsupported")
    kind = changes[0]
    async with db.transaction() as conn:
        await conn.execute("SELECT 1 FROM sources WHERE id = $1 FOR UPDATE", row["id"])
        before = (await sample.snapshot(conn, row["id"]))[body.stream]
        if kind == "add_field" and (not FIELD_NAME.fullmatch(body.add_field) or body.add_field in before.fields):
            raise validation({"add_field": "Name a new field: a lowercase letter, then up to 30 letters, digits or _."})
        await conn.execute("INSERT INTO sample_events (source_id, stream, kind, payload, at) VALUES ($1, $2, $3, $4, $5)",
                           row["id"], body.stream, kind, {kind: getattr(body, kind)}, utcnow())
        after = (await sample.snapshot(conn, row["id"]))[body.stream]
    updated = len(set(body.update_ids or []) & set(before.records))
    return {"stream": body.stream, "appended": body.append or 0, "updated": updated, "fields": after.fields}


def destination_view(row) -> dict:
    return {"id": str(row["id"]), "name": row["name"], "definition_id": row["definition_id"],
            "created_at": iso(row["created_at"])}


@router.get("/api/destinations", response_model=Destinations)
async def destinations(member: Member = Depends(current_member)) -> dict:
    async with db.snapshot() as conn:
        rows = await conn.fetch("SELECT * FROM destinations WHERE workspace_id = $1 ORDER BY created_at, name",
                                member.workspace_id)
    return {"destinations": [destination_view(row) for row in rows]}


@router.post("/api/destinations", status_code=201, response_model=DestinationOut)
async def create_destination(request: Request, member: Member = Depends(current_member)) -> dict:
    member.require("editor")
    body = parse(request, DestinationIn)
    async with db.transaction() as conn:
        definition = await _definition_for(conn, member, body.definition_id, "destination")
        errors = _name_error(body.name)
        if definition is None:
            errors["definition_id"] = "Choose a destination connector from the catalog."
        if errors:
            raise validation(errors)
        if not definition["runnable"]:
            raise ApiError(422, "connector_not_installed")
        row = await conn.fetchrow("INSERT INTO destinations (id, workspace_id, name, definition_id, created_at) "
                                  "VALUES ($1, $2, $3, $4, $5) RETURNING *", uuid.uuid4(), member.workspace_id,
                                  body.name, definition["id"], utcnow())
        await warehouse.create_schema(conn, row["id"])
        await audit.append(conn, member.workspace_id, "destination.created", row["id"], member.email)
    return {"destination": destination_view(row)}


@router.get("/api/destinations/{destination_id}/tables", response_model=Tables)
async def tables(destination_id: str, member: Member = Depends(current_member)) -> dict:
    async with db.snapshot() as conn:
        row = await owned(conn, "destination", destination_id, member.workspace_id)
        return {"tables": await warehouse.tables(conn, row["id"])}


@router.get("/api/destinations/{destination_id}/tables/{table}/records", response_model=Records)
async def records(destination_id: str, table: str, request: Request,
                  member: Member = Depends(current_member)) -> dict:
    async with db.snapshot() as conn:
        destination = await owned(conn, "destination", destination_id, member.workspace_id)
        listed = await warehouse.table_of(conn, destination["id"], table)
        limit = paging.limit_of(request.query_params.get("limit"), 50)
        return await warehouse.records_page(conn, member.workspace_id, destination["id"], listed, limit,
                                            request.query_params.get("cursor"))

