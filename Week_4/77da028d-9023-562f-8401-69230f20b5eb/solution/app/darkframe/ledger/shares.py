"""Revocable read-only project links and the shared page's body."""
from datetime import UTC, datetime
from typing import Any

from aiohttp import web

from darkframe.common.http import imager_id, json_response, read_json_object
from darkframe.common.ids import share_token
from darkframe.common.validate import parse_offset_datetime
from darkframe.ledger import entries
from darkframe.ledger.context import Context
from darkframe.ledger.projects import fetch_project
from darkframe.rules.errors import not_found, validation
from darkframe.rules.rounding import share_grid
from darkframe.rules.timestamps import utc_text


def share_body(token: str, expires_at: datetime | None) -> dict[str, Any]:
    return {"token": token, "url": f"/s/{token}", "expires_at": utc_text(expires_at) if expires_at else None}


class ShareRoutes:
    def __init__(self, context: Context) -> None:
        self.context = context

    def add_to(self, app: web.Application) -> None:
        app.add_routes([
            web.post("/api/projects/{id}/share", self.create),
            web.get("/api/projects/{id}/share", self.get),
            web.delete("/api/projects/{id}/share", self.revoke),
            web.get("/api/shared/{token}", self.shared),
        ])

    async def live_share(self, connection: Any, imager: str, project_id: str) -> Any:
        await fetch_project(connection, imager, project_id)
        row = await connection.fetchrow("SELECT * FROM ledger.shares WHERE project_id = $1", project_id)
        if row is None or (row["expires_at"] is not None and row["expires_at"] <= datetime.now(UTC)):
            raise not_found()
        return row

    async def create(self, request: web.Request) -> web.Response:
        imager = imager_id(request)
        requested = (await read_json_object(request)).get("expires_at")
        expires = None
        if requested is not None:
            expires = parse_offset_datetime(requested) if isinstance(requested, str) else None
            if expires is None or expires <= datetime.now(UTC):
                raise validation({"expires_at": "Link expires must be a UTC time in the future, or null."})
        token = share_token()
        async with self.context.database.transaction() as connection:
            project = await fetch_project(connection, imager, request.match_info["id"])
            await connection.execute(
                "INSERT INTO ledger.shares (project_id, token, imager_id, expires_at) VALUES ($1, $2, $3, $4) "
                "ON CONFLICT (project_id) DO UPDATE SET token = EXCLUDED.token, expires_at = EXCLUDED.expires_at, "
                "created_at = now()", project["id"], token, imager, expires)
        return json_response(share_body(token, expires), 201)

    async def get(self, request: web.Request) -> web.Response:
        async with self.context.database.connection() as connection:
            row = await self.live_share(connection, imager_id(request), request.match_info["id"])
        return json_response(share_body(row["token"], row["expires_at"]))

    async def revoke(self, request: web.Request) -> web.Response:
        async with self.context.database.transaction() as connection:
            row = await self.live_share(connection, imager_id(request), request.match_info["id"])
            await connection.execute("DELETE FROM ledger.shares WHERE project_id = $1", row["project_id"])
        return web.Response(status=204)

    async def shared(self, request: web.Request) -> web.Response:
        async with self.context.database.connection() as connection:
            row = await connection.fetchrow(
                "SELECT s.imager_id, p.* FROM ledger.shares s JOIN ledger.projects p ON p.id = s.project_id "
                "WHERE s.token = $1 AND (s.expires_at IS NULL OR s.expires_at > now())", request.match_info["token"])
            if row is None:
                raise not_found()
            filters = await entries.project_filters(connection, row["id"])
            sessions = await connection.fetchval(
                "SELECT count(*) FROM ledger.sessions WHERE project_id = $1 AND state <> 'trashed'", row["id"])
        site = await self.context.site(row["imager_id"])
        return json_response({
            "project_name": row["name"], "target_name": row["target_name"], "state": row["state"], "filters": filters,
            "total_integration_seconds": sum(item["logged_seconds"] for item in filters), "session_count": sessions,
            "site": {"latitude": share_grid(site["latitude"]), "longitude": share_grid(site["longitude"])}})
