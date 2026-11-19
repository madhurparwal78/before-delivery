"""Connector Builder projects, their test reads, publishing, and the sandbox API."""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Request

from ..audit import append_event
from ..builder import detect_schema, read_stream, stream_of, validate_manifest
from ..context import require_session, require_writer
from ..db import database
from ..errors import ApiError, validation_error
from ..mock_api import INVOICES_PATH, read_page
from ..models import BuilderProjectBody, BuilderTestBody, EmptyBody
from ..validation import parse_body
from .common import ok, path_uuid, raw_body

router = APIRouter()


def project_payload(row: Any) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "name": row["name"],
        "manifest": row["manifest"],
        "tested_streams": row["tested_streams"],
        "definition_id": row["definition_id"],
    }


async def _load_project(conn: Any, project_id: str, workspace_id: uuid.UUID) -> Any:
    row = await conn.fetchrow(
        "SELECT * FROM builder_projects WHERE id = $1 AND workspace_id = $2",
        path_uuid(project_id),
        workspace_id,
    )
    if row is None:
        raise ApiError("not_found")
    return row


@router.get("/api/builder/projects")
async def list_projects(request: Request) -> Any:
    caller = await require_session(request)
    require_writer(caller)
    rows = await database.fetch(
        "SELECT * FROM builder_projects WHERE workspace_id = $1 ORDER BY created_at", caller.workspace_id
    )
    return ok({"projects": [project_payload(row) for row in rows]})


@router.get("/api/builder/projects/{project_id}")
async def read_project(request: Request, project_id: str) -> Any:
    caller = await require_session(request)
    async with database.acquire() as conn:
        row = await _load_project(conn, project_id, caller.workspace_id)
    require_writer(caller)
    return ok({"project": project_payload(row)})


@router.post("/api/builder/projects")
async def create_project(request: Request) -> Any:
    caller = await require_session(request)
    require_writer(caller)
    body = parse_body(await raw_body(request), BuilderProjectBody)
    manifest = body.manifest.model_dump()
    validate_manifest(manifest)
    project_id = uuid.uuid4()
    row = await database.fetchrow(
        """
        INSERT INTO builder_projects (id, workspace_id, name, manifest, tested_streams, created_at)
        VALUES ($1, $2, $3, $4, '{}'::jsonb, $5) RETURNING *
        """,
        project_id,
        caller.workspace_id,
        body.name,
        manifest,
        datetime.now(timezone.utc),
    )
    return ok({"project": project_payload(row)}, status=201)


@router.put("/api/builder/projects/{project_id}")
async def replace_project(request: Request, project_id: str) -> Any:
    caller = await require_session(request)
    async with database.acquire() as conn:
        stored = await _load_project(conn, project_id, caller.workspace_id)
    require_writer(caller)
    body = parse_body(await raw_body(request), BuilderProjectBody)
    manifest = body.manifest.model_dump()
    validate_manifest(manifest)
    kept = {
        name: schema
        for name, schema in stored["tested_streams"].items()
        if _unchanged_stream(stored["manifest"], manifest, name)
    }
    row = await database.fetchrow(
        "UPDATE builder_projects SET name = $2, manifest = $3, tested_streams = $4 WHERE id = $1 RETURNING *",
        stored["id"],
        body.name,
        manifest,
        kept,
    )
    return ok({"project": project_payload(row)})


def _unchanged_stream(before: dict[str, Any], after: dict[str, Any], name: str) -> bool:
    """A stream that changed loses its tested state."""
    if before["base_url"] != after["base_url"] or before["auth"] != after["auth"]:
        return False
    found = [stream for stream in before["streams"] if stream["name"] == name]
    current = [stream for stream in after["streams"] if stream["name"] == name]
    return bool(found) and found == current


@router.post("/api/builder/projects/{project_id}/test")
async def test_project(request: Request, project_id: str) -> Any:
    caller = await require_session(request)
    async with database.acquire() as conn:
        stored = await _load_project(conn, project_id, caller.workspace_id)
    require_writer(caller)
    body = parse_body(await raw_body(request), BuilderTestBody)
    manifest = stored["manifest"]
    validate_manifest(manifest)
    stream_of(manifest, body.stream)
    records, pages_read = read_stream(manifest, body.stream, body.api_key)
    detected = detect_schema(records)
    tested = {**stored["tested_streams"], body.stream: detected}
    await database.execute(
        "UPDATE builder_projects SET tested_streams = $2 WHERE id = $1", stored["id"], tested
    )
    return ok({"records": records, "pages_read": pages_read, "detected_schema": detected})


@router.post("/api/builder/projects/{project_id}/publish")
async def publish_project(request: Request, project_id: str) -> Any:
    caller = await require_session(request)
    async with database.acquire() as conn:
        stored = await _load_project(conn, project_id, caller.workspace_id)
    require_writer(caller)
    parse_body(await raw_body(request), EmptyBody)
    manifest = stored["manifest"]
    tested = stored["tested_streams"]
    if any(stream["name"] not in tested for stream in manifest["streams"]):
        raise ApiError("stream_not_tested")
    async with database.transaction() as conn:
        definition_id = stored["definition_id"]
        if definition_id is None:
            definition_id = f"custom-{stored['id']}"
            row = await conn.fetchrow(
                """
                INSERT INTO connector_definitions
                    (id, name, slug, type, category, availability, runnable, custom, workspace_id,
                     version, manifests, detected_schemas)
                VALUES ($1, $2, $3, 'source', 'Others', ARRAY['cloud'], true, true, $4, 1, $5, $6)
                RETURNING *
                """,
                definition_id,
                stored["name"],
                _slug(stored["name"]),
                caller.workspace_id,
                {"1": manifest},
                tested,
            )
            await conn.execute(
                "UPDATE builder_projects SET definition_id = $2 WHERE id = $1", stored["id"], definition_id
            )
        else:
            current = await conn.fetchrow(
                "SELECT * FROM connector_definitions WHERE id = $1 FOR UPDATE", definition_id
            )
            version = current["version"] + 1
            row = await conn.fetchrow(
                """
                UPDATE connector_definitions
                SET version = $2, manifests = manifests || $3::jsonb, detected_schemas = $4, name = $5
                WHERE id = $1 RETURNING *
                """,
                definition_id,
                version,
                {str(version): manifest},
                tested,
                stored["name"],
            )
        await append_event(
            conn,
            workspace_id=caller.workspace_id,
            action="connector.published",
            target_id=definition_id,
            actor_email=caller.email,
        )
    return ok(
        {
            "definition": {
                "id": row["id"],
                "name": row["name"],
                "slug": row["slug"],
                "type": row["type"],
                "category": row["category"],
                "availability": list(row["availability"]),
                "runnable": row["runnable"],
                "custom": row["custom"],
                "version": row["version"],
            }
        },
        status=201,
    )


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


@router.get("/mock-api/v1/invoices")
async def sandbox_invoices(request: Request) -> Any:
    page = _whole_number(request.query_params.get("page"), 1, "page", 1, 999_999)
    page_size = _whole_number(request.query_params.get("page_size"), 3, "page_size", 1, 100)
    status, body = read_page(INVOICES_PATH, page, page_size, request.headers.get("x-api-key"))
    if status == 401:
        raise ApiError("unauthenticated")
    return ok(body)


def _whole_number(raw: str | None, default: int, name: str, low: int, high: int) -> int:
    if raw is None:
        return default
    if not re.fullmatch(r"[0-9]{1,6}", raw) or not low <= int(raw) <= high:
        raise validation_error({name: f"This value must be a whole number from {low} to {high}."})
    return int(raw)
