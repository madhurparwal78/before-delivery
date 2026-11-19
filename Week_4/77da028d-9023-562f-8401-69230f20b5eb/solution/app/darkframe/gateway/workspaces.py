"""Creating a workspace, unlocking and locking it, and whoami."""
from aiohttp import web

from darkframe.common.database import Database
from darkframe.common.http import InternalClient, json_response, read_json_object
from darkframe.common.ids import new_id, workspace_key
from darkframe.common.validate import Fields
from darkframe.gateway import store
from darkframe.gateway.auth import COOKIE, COOKIE_MAX_AGE_SECONDS, Keys
from darkframe.rules.errors import ApiFault, validation


class WorkspaceRoutes:
    def __init__(self, database: Database, keys: Keys, client: InternalClient) -> None:
        self.database = database
        self.keys = keys
        self.client = client

    def add_to(self, app: web.Application) -> None:
        app.add_routes([
            web.post("/api/workspaces", self.create),
            web.post("/api/unlock", self.unlock),
            web.post("/api/lock-workspace", self.lock),
            web.get("/api/me", self.me),
        ])

    async def create(self, request: web.Request) -> web.Response:
        body = await read_json_object(request)
        fields = Fields(body)
        name = fields.text("name", 1, 80, "Name")
        errors = dict(fields.errors)
        imager, key = new_id(), workspace_key()
        try:
            await self.client.json("sky-engine", "POST", "/internal/imagers", body={"imager_id": imager, "site": body.get("site")})
        except ApiFault as fault:
            if fault.status != 422:
                raise
            errors.update(fault.fields or {})
        if errors:
            raise validation(errors)
        async with self.database.connection() as connection:
            await store.add_workspace(connection, imager, name, key)
        return json_response({"imager_id": imager, "name": name, "key": key}, 201)

    async def unlock(self, request: web.Request) -> web.Response:
        key = (await read_json_object(request)).get("key")
        imager = await self.keys.lookup(key) if isinstance(key, str) and key else None
        if imager is None:
            raise ApiFault(401, "invalid_key", "That workspace key is not recognised.")
        response = web.Response(status=204)
        response.set_cookie(COOKIE, key, httponly=True, samesite="Strict", path="/", max_age=COOKIE_MAX_AGE_SECONDS)
        return response

    async def lock(self, request: web.Request) -> web.Response:
        await self.keys.require(request)
        response = web.Response(status=204)
        response.del_cookie(COOKIE, path="/")
        return response

    async def me(self, request: web.Request) -> web.Response:
        imager = await self.keys.require(request)
        return json_response({"imager_id": imager.imager_id, "name": imager.name})
