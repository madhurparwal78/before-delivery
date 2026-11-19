"""The gateway process: the only public listener."""
import asyncio

from aiohttp import web

from darkframe.common.config import load_settings
from darkframe.common.database import Database
from darkframe.common.http import InternalClient, request_context
from darkframe.common.s3 import ObjectStore
from darkframe.gateway import store
from darkframe.gateway.auth import Keys
from darkframe.gateway.boundary import enforce_boundary
from darkframe.gateway.health import Health
from darkframe.gateway.proxy import Proxy
from darkframe.gateway.static import Pages
from darkframe.gateway.workspaces import WorkspaceRoutes

LABEL = "The gateway"


def build_app() -> web.Application:
    settings = load_settings()
    database = Database(settings.database_url, LABEL, store.migrate, "gateway")
    client = InternalClient(settings)
    objects = ObjectStore(settings)
    keys = Keys(database)
    app = web.Application(middlewares=[request_context, enforce_boundary], client_max_size=0)
    health = Health(settings, database, objects, client)
    app.add_routes([web.get("/api/health", health.handle)])
    WorkspaceRoutes(database, keys, client).add_to(app)
    proxy = Proxy(keys, client)
    app.add_routes([web.route("*", "/api/{tail:.*}", proxy.handle)])
    Pages(keys).add_to(app)

    async def start(_: web.Application) -> None:
        app["task"] = asyncio.create_task(database.keep_ready())

    async def stop(_: web.Application) -> None:
        app["task"].cancel()
        await client.close()
        await objects.close()
        await database.close()

    app.on_startup.append(start)
    app.on_cleanup.append(stop)
    app["port"] = settings.public_port
    return app


def main() -> None:
    app = build_app()
    web.run_app(app, host="0.0.0.0", port=app["port"], access_log=None, print=None)


if __name__ == "__main__":
    main()
