"""Builder projects: save, test read against the sandbox, publish as a custom source definition."""

import asyncio
import uuid

import asyncpg
from fastapi import APIRouter, Depends, Request

from .. import audit, builder, catalog
from ..auth import Member, current_member
from ..db import db, utcnow
from ..errors import ApiError, validation
from ..inputs import Body, name_error, parse
from ..objects import owned
from ..views import DefinitionOut, ProjectOut, Projects, TestRead

router = APIRouter()


class ProjectIn(Body):
    name: str
    manifest: builder.ManifestIn


class TestIn(Body):
    stream: str
    api_key: str


def _checked(body: ProjectIn) -> dict:
    errors = builder.manifest_errors(body.manifest)
    if message := name_error(body.name):
        errors["name"] = message
    if errors:
        raise validation(errors)
    return body.manifest.model_dump()


def project_view(row: asyncpg.Record) -> dict:
    """`tested_streams` lists the streams whose last test still matches the manifest."""
    manifest = row["manifest"]
    names = [stream["name"] for stream in manifest["streams"]]
    tested = [name for name in names if row["tested_streams"].get(name, {}).get("fingerprint")
              == builder.stream_fingerprint(manifest, name)]
    return {"id": str(row["id"]), "name": row["name"], "manifest": manifest, "tested_streams": tested,
            "definition_id": row["definition_id"]}


@router.get("/api/builder/projects", response_model=Projects)
async def projects(member: Member = Depends(current_member)) -> dict:
    member.require("editor")
    async with db.snapshot() as conn:
        rows = await conn.fetch("SELECT * FROM builder_projects WHERE workspace_id = $1 ORDER BY created_at",
                                member.workspace_id)
    return {"projects": [project_view(row) for row in rows]}


@router.post("/api/builder/projects", status_code=201, response_model=ProjectOut)
async def create_project(request: Request, member: Member = Depends(current_member)) -> dict:
    member.require("editor")
    body = parse(request, ProjectIn)
    manifest = _checked(body)
    async with db.transaction() as conn:
        row = await conn.fetchrow("INSERT INTO builder_projects (id, workspace_id, name, manifest, tested_streams, "
                                  "created_at) VALUES ($1, $2, $3, $4, '{}', $5) RETURNING *", uuid.uuid4(),
                                  member.workspace_id, body.name.strip(), manifest, utcnow())
    return {"project": project_view(row)}


async def _project(conn: asyncpg.Connection, project_id: str, member: Member, lock: bool = False) -> asyncpg.Record:
    row = await owned(conn, "project", project_id, member.workspace_id, lock)
    member.require("editor")
    return row


@router.get("/api/builder/projects/{project_id}", response_model=ProjectOut)
async def project(project_id: str, member: Member = Depends(current_member)) -> dict:
    async with db.snapshot() as conn:
        return {"project": project_view(await _project(conn, project_id, member))}


@router.put("/api/builder/projects/{project_id}", response_model=ProjectOut)
async def replace_project(project_id: str, request: Request, member: Member = Depends(current_member)) -> dict:
    async with db.snapshot() as conn:
        await _project(conn, project_id, member)
    body = parse(request, ProjectIn)
    manifest = _checked(body)
    async with db.transaction() as conn:
        row = await conn.fetchrow("UPDATE builder_projects SET name = $2, manifest = $3 WHERE id = $1 RETURNING *",
                                  uuid.UUID(project_id), body.name.strip(), manifest)
    return {"project": project_view(row)}


@router.post("/api/builder/projects/{project_id}/test", response_model=TestRead)
async def test_read(project_id: str, request: Request, member: Member = Depends(current_member)) -> dict:
    async with db.snapshot() as conn:
        row = await _project(conn, project_id, member)
    body = parse(request, TestIn)
    manifest = row["manifest"]
    if body.stream not in [stream["name"] for stream in manifest["streams"]]:
        raise validation({"stream": "Choose a stream from the manifest."})
    result = await asyncio.to_thread(builder.read_stream, manifest, body.stream, body.api_key)
    if result.http_status is not None:
        raise ApiError(422, "source_http_error", extra={"http_status": result.http_status})
    schema = builder.detect_schema(result.records)
    async with db.transaction() as conn:
        await conn.execute(
            "UPDATE builder_projects SET tested_streams = tested_streams || jsonb_build_object($2::text, $3::jsonb) "
            "WHERE id = $1", row["id"], body.stream,
            {"fingerprint": builder.stream_fingerprint(manifest, body.stream), "detected_schema": schema})
    return {"records": result.records, "pages_read": result.pages_read, "detected_schema": schema}


@router.post("/api/builder/projects/{project_id}/publish", status_code=201, response_model=DefinitionOut)
async def publish(project_id: str, request: Request, member: Member = Depends(current_member)) -> dict:
    async with db.snapshot() as conn:
        await _project(conn, project_id, member)
    parse(request, Body)
    async with db.transaction() as conn:
        row = await _project(conn, project_id, member, lock=True)
        view = project_view(row)
        manifest = row["manifest"]
        if len(view["tested_streams"]) != len(manifest["streams"]):
            raise ApiError(422, "stream_not_tested")
        published = {"manifest": manifest, "schemas": {name: row["tested_streams"][name]["detected_schema"]
                                                       for name in view["tested_streams"]}}
        if row["definition_id"] is None:
            definition_id = str(uuid.uuid4())
            await conn.execute(
                """INSERT INTO connector_definitions (id, name, slug, type, category, availability, runnable, custom,
                                                      version, workspace_id, versions, created_at)
                   VALUES ($1, $2, $3, 'source', $4, $5, true, true, 1, $6, $7, $8)""",
                definition_id, row["name"], catalog.slug(row["name"]), catalog.CUSTOM_CATEGORY, ["cloud"],
                member.workspace_id, {"1": published}, utcnow())
            await conn.execute("UPDATE builder_projects SET definition_id = $2 WHERE id = $1", row["id"], definition_id)
        else:
            definition_id = row["definition_id"]
            await conn.execute(
                "UPDATE connector_definitions SET version = version + 1, name = $2, slug = $3, "
                "versions = versions || jsonb_build_object((version + 1)::text, $4::jsonb) WHERE id = $1",
                definition_id, row["name"], catalog.slug(row["name"]), published)
        await audit.append(conn, member.workspace_id, "connector.published", definition_id, member.email)
        definition = await conn.fetchrow("SELECT * FROM connector_definitions WHERE id = $1", definition_id)
    return {"definition": catalog.public(definition)}
