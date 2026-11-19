"""The ledger process."""
import asyncio

from aiohttp import web

from darkframe.common.config import load_settings
from darkframe.common.database import Database
from darkframe.common.http import InternalClient, health_handler, request_context
from darkframe.common.s3 import ObjectStore, StorageUnavailable
from darkframe.ledger import schema
from darkframe.ledger.calibration import CalibrationRoutes
from darkframe.ledger.context import Context
from darkframe.ledger.frames import FrameRoutes
from darkframe.ledger.projects import ProjectRoutes
from darkframe.ledger.sessions import SessionRoutes
from darkframe.ledger.shares import ShareRoutes

SERVICE = "ledger"
LABEL = "The ledger"
UPLOAD_LIMIT_BYTES = 20_000_000
STORAGE_RETRY_SECONDS = 3


async def prepare_storage(objects: ObjectStore) -> None:
    """Create the bucket if needed and upload the seeded masters, retrying until the object store answers."""
    while True:
        try:
            await objects.ensure_bucket()
            await schema.seed_masters(objects)
            return
        except StorageUnavailable:
            await asyncio.sleep(STORAGE_RETRY_SECONDS)


def build_app() -> web.Application:
    settings = load_settings()
    database = Database(settings.database_url, LABEL, schema.migrate, "ledger")
    objects = ObjectStore(settings)
    client = InternalClient(settings)
    context = Context(settings, database, objects, client)
    app = web.Application(middlewares=[request_context], client_max_size=UPLOAD_LIMIT_BYTES + 1024)
    app.add_routes([web.get("/internal/health", health_handler(SERVICE))])
    for routes in (ProjectRoutes, SessionRoutes, FrameRoutes, CalibrationRoutes, ShareRoutes):
        routes(context).add_to(app)

    async def start(_: web.Application) -> None:
        app["tasks"] = [asyncio.create_task(database.keep_ready()), asyncio.create_task(prepare_storage(objects))]

    async def stop(_: web.Application) -> None:
        for task in app["tasks"]:
            task.cancel()
        await client.close()
        await objects.close()
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
