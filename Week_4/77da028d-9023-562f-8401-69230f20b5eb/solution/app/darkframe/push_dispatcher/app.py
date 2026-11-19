"""The push dispatcher process."""
import asyncio

from aiohttp import web

from darkframe.common.config import load_settings
from darkframe.common.database import Database
from darkframe.common.http import InternalClient, health_handler, request_context
from darkframe.push_dispatcher import store
from darkframe.push_dispatcher.publisher import Publisher
from darkframe.push_dispatcher.routes import Routes

SERVICE = "push-dispatcher"
LABEL = "The push dispatcher"


def build_app() -> web.Application:
    settings = load_settings()
    database = Database(settings.database_url, LABEL, store.migrate, "push_dispatcher")
    client = InternalClient(settings)
    publisher = Publisher(settings, database, client)
    app = web.Application(middlewares=[request_context])
    app.add_routes([web.get("/internal/health", health_handler(SERVICE))])
    Routes(database, client).add_to(app)

    async def start(_: web.Application) -> None:
        async def run_when_ready() -> None:
            await database.keep_ready()
            await publisher.run()
        app["task"] = asyncio.create_task(run_when_ready())

    async def stop(_: web.Application) -> None:
        app["task"].cancel()
        await publisher.close()
        await client.close()
        await database.close()

    app.on_startup.append(start)
    app.on_cleanup.append(stop)
    app["port"] = settings.service_port(SERVICE)
    return app


def main() -> None:
    app = build_app()
    web.run_app(app, host="127.0.0.1", port=app["port"], access_log=None, print=None)


if __name__ == "__main__":
    main()
