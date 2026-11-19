"""The sky engine process."""
import asyncio

from aiohttp import web

from darkframe.common.config import load_settings
from darkframe.common.database import Database
from darkframe.common.http import InternalClient, health_handler, request_context
from darkframe.sky_engine import store
from darkframe.sky_engine.planning import Planner
from darkframe.sky_engine.routes import Routes

SERVICE = "sky-engine"
LABEL = "The sky engine"


def build_app() -> web.Application:
    settings = load_settings()
    database = Database(settings.database_url, LABEL, store.migrate, "sky_engine")
    client = InternalClient(settings)
    app = web.Application(middlewares=[request_context])
    app.add_routes([web.get("/internal/health", health_handler(SERVICE))])
    Routes(Planner(settings, database, client)).add_to(app)

    async def start_database(_: web.Application) -> None:
        app["database_task"] = asyncio.create_task(database.keep_ready())

    async def stop(_: web.Application) -> None:
        app["database_task"].cancel()
        await client.close()
        await database.close()

    app.on_startup.append(start_database)
    app.on_cleanup.append(stop)
    app["port"] = settings.service_port(SERVICE)
    return app


def main() -> None:
    app = build_app()
    web.run_app(app, host="127.0.0.1", port=app["port"], access_log=None, print=None)


if __name__ == "__main__":
    main()
