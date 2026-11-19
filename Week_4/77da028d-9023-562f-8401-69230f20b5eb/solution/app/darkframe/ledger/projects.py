"""Projects, their allotments and ledger, and the project state machine."""
from typing import Any

import asyncpg
from aiohttp import web

from darkframe.common.http import imager_id, json_response, read_json_object
from darkframe.common.ids import new_id
from darkframe.common.validate import Fields
from darkframe.ledger import entries
from darkframe.ledger.context import Context
from darkframe.rules.errors import conflict, not_found, validation
from darkframe.rules.states import (
    PROJECT_CLOSED_STATES,
    PROJECT_EDGES,
    PROJECT_TARGET_STATES,
    refuse_edge,
)
from darkframe.rules.timestamps import utc_text

PLANNED_SECONDS_LIMIT = 3_600_000


async def fetch_project(connection: asyncpg.Connection, imager: str, project_id: str, *, lock: bool = False) -> asyncpg.Record:
    row = await connection.fetchrow(
        "SELECT * FROM ledger.projects WHERE id = $1 AND imager_id = $2" + (" FOR UPDATE" if lock else ""),
        project_id, imager)
    if row is None:
        raise not_found()
    return row


async def project_body(connection: asyncpg.Connection, row: asyncpg.Record | dict[str, Any]) -> dict[str, Any]:
    filters = await entries.project_filters(connection, row["id"])
    sessions = await connection.fetchval(
        "SELECT count(*) FROM ledger.sessions WHERE project_id = $1 AND state <> 'trashed'", row["id"])
    return {"id": row["id"], "name": row["name"], "target_name": row["target_name"], "ra_deg": row["ra_deg"],
            "dec_deg": row["dec_deg"], "state": row["state"], "filters": filters,
            "total_integration_seconds": sum(item["logged_seconds"] for item in filters), "session_count": sessions}


def project_fields(body: dict[str, Any], *, partial: bool) -> dict[str, Any]:
    fields = Fields(body)
    changes: dict[str, Any] = {}
    readers = {
        "name": lambda: fields.text("name", 1, 80, "Project name"),
        "target_name": lambda: fields.text("target_name", 1, 80, "Target name"),
        "ra_deg": lambda: fields.number("ra_deg", 0, 360, "Right ascension"),
        "dec_deg": lambda: fields.number("dec_deg", -90, 90, "Declination"),
    }
    for name, read in readers.items():
        if name in body or not partial:
            changes[name] = read()
    if changes.get("ra_deg") is not None and changes["ra_deg"] >= 360:
        fields.fail("ra_deg", "Right ascension must be a number from 0 up to but not including 360.")
    fields.raise_errors()
    return changes


class ProjectRoutes:
    def __init__(self, context: Context) -> None:
        self.context = context

    def add_to(self, app: web.Application) -> None:
        app.add_routes([
            web.get("/api/projects", self.list),
            web.post("/api/projects", self.create),
            web.get("/api/projects/{id}", self.get),
            web.patch("/api/projects/{id}", self.patch),
            web.post("/api/projects/{id}/transition", self.transition),
            web.put("/api/projects/{id}/allotments/{filter}", self.set_allotment),
            web.get("/api/projects/{id}/ledger", self.ledger),
        ])

    async def list(self, request: web.Request) -> web.Response:
        async with self.context.database.connection() as connection:
            rows = await connection.fetch("SELECT * FROM ledger.projects WHERE imager_id = $1 ORDER BY lower(name), name",
                                          imager_id(request))
            return json_response({"projects": [await project_body(connection, row) for row in rows]})

    async def create(self, request: web.Request) -> web.Response:
        fields = project_fields(await read_json_object(request), partial=False)
        project = new_id()
        async with self.context.database.transaction() as connection:
            await connection.execute(
                "INSERT INTO ledger.projects (id, imager_id, name, target_name, ra_deg, dec_deg, state) "
                "VALUES ($1, $2, $3, $4, $5, $6, 'draft')", project, imager_id(request), fields["name"],
                fields["target_name"], fields["ra_deg"], fields["dec_deg"])
            return json_response(await project_body(connection, await fetch_project(connection, imager_id(request), project)), 201)

    async def get(self, request: web.Request) -> web.Response:
        async with self.context.database.connection() as connection:
            row = await fetch_project(connection, imager_id(request), request.match_info["id"])
            return json_response(await project_body(connection, row))

    async def patch(self, request: web.Request) -> web.Response:
        imager = imager_id(request)
        body = await read_json_object(request)
        async with self.context.database.transaction() as connection:
            row = await fetch_project(connection, imager, request.match_info["id"], lock=True)
            if row["state"] in PROJECT_CLOSED_STATES:
                raise conflict("project_closed", "A complete or archived project cannot be changed.")
            changes = project_fields(body, partial=True)
            for name, value in changes.items():
                await connection.execute(f"UPDATE ledger.projects SET {name} = $2 WHERE id = $1", row["id"], value)
            result = await project_body(connection, await fetch_project(connection, imager, row["id"]))
        await self.context.changed(imager)
        return json_response(result)

    async def transition(self, request: web.Request) -> web.Response:
        imager = imager_id(request)
        target = (await read_json_object(request)).get("to")
        async with self.context.database.transaction() as connection:
            row = await fetch_project(connection, imager, request.match_info["id"], lock=True)
            if target not in PROJECT_TARGET_STATES:
                raise validation({"to": f"State must be one of {', '.join(PROJECT_TARGET_STATES)}."})
            refuse_edge("project", PROJECT_EDGES, row["state"], target)
            filters = await entries.project_filters(connection, row["id"])
            if target == "active" and row["state"] == "draft" and not any(f["planned_seconds"] > 0 for f in filters):
                raise conflict("no_allotments", "Set planned time for at least one filter before activating.")
            if target == "complete" and any(f["owed_seconds"] > 0 for f in filters):
                raise conflict("hours_still_owed", "Every filter must have nothing owed before the project is complete.")
            await connection.execute("UPDATE ledger.projects SET state = $2 WHERE id = $1", row["id"], target)
            result = await project_body(connection, await fetch_project(connection, imager, row["id"]))
        await self.context.changed(imager)
        return json_response(result)

    async def set_allotment(self, request: web.Request) -> web.Response:
        imager = imager_id(request)
        filter_name = request.match_info["filter"]
        body = await read_json_object(request)
        async with self.context.database.transaction() as connection:
            row = await fetch_project(connection, imager, request.match_info["id"], lock=True)
            if row["state"] in PROJECT_CLOSED_STATES:
                raise conflict("project_closed", "A complete or archived project cannot be changed.")
            errors: dict[str, str] = {}
            if filter_name not in entries.FILTERS:
                errors["filter"] = f"Filter must be one of {', '.join(entries.FILTERS)}."
            fields = Fields(body)
            planned = fields.whole("planned_seconds", 0, PLANNED_SECONDS_LIMIT, "Planned time")
            if planned is not None and planned % 60:
                fields.fail("planned_seconds", "Planned time must be a whole number of minutes.")
            errors.update(fields.errors)
            if errors:
                raise validation(errors)
            current = next((f["planned_seconds"] for f in await entries.project_filters(connection, row["id"])
                            if f["filter"] == filter_name), 0)
            if planned != current:
                await entries.post_allotment(connection, row["id"], filter_name, planned - current)
            result = await project_body(connection, await fetch_project(connection, imager, row["id"]))
        await self.context.changed(imager)
        return json_response(result)

    async def ledger(self, request: web.Request) -> web.Response:
        async with self.context.database.connection() as connection:
            row = await fetch_project(connection, imager_id(request), request.match_info["id"])
            records = await connection.fetch("SELECT * FROM ledger.entries WHERE project_id = $1 ORDER BY seq", row["id"])
        return json_response({"entries": [{
            "id": r["id"], "movement_id": r["movement_id"], "movement_kind": r["movement_kind"], "filter": r["filter"],
            "account": r["account"], "seconds": r["seconds"], "session_id": r["session_id"], "batch_id": r["batch_id"],
            "reverses_movement_id": r["reverses_movement_id"],
            "created_at": utc_text(r["created_at"])} for r in records]})
