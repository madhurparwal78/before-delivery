"""Sky engine entrypoint: routes on 127.0.0.1:<public port + 100>."""
from __future__ import annotations

import os
from contextlib import asynccontextmanager

from starlette.responses import JSONResponse
from starlette.routing import Route

from darkframe.common.db import Database
from darkframe.common.http import build_app
from darkframe.services.sky_engine import api as sky_api
from darkframe.services.sky_engine import plans

VERSION = "1.0.0"


async def health(request):
    return JSONResponse({"name": "sky-engine", "version": VERSION, "status": "ok"})


def routes() -> list[Route]:
    return [
        Route("/internal/health", health, methods=["GET"]),
        Route("/site", sky_api.get_site, methods=["GET"]),
        Route("/site", sky_api.patch_site, methods=["PATCH"]),
        Route("/site/horizon", sky_api.get_horizon, methods=["GET"]),
        Route("/site/horizon", sky_api.put_horizon, methods=["PUT"]),
        Route("/sky/night", plans.get_night, methods=["GET"]),
        Route("/tonight", plans.get_tonight, methods=["GET"]),
        Route("/plans/{date}", plans.get_plan, methods=["GET"]),
        Route("/plans/{date}/targets", plans.add_target, methods=["POST"]),
        Route("/plans/{date}/targets/{project_id}", plans.remove_target, methods=["DELETE"]),
        Route("/plans/{date}/conditions", plans.put_conditions, methods=["PUT"]),
        Route("/reminders/new-moon", plans.reminders_get, methods=["GET"]),
        Route("/reminders/new-moon", plans.reminders_put, methods=["PUT"]),
        Route("/reminders/new-moon/occurrences", plans.reminder_occurrences, methods=["GET"]),
    ]


def create_app():
    url = os.environ["DATABASE_URL"]

    @asynccontextmanager
    async def lifespan(app):
        sky_api.DB = Database(url, "sky_engine")
        sky_api.DB.ensure_schema()
        yield
        sky_api.DB.close()

    return build_app(routes(), "sky-engine", lifespan=lifespan)


def serve() -> None:
    import uvicorn

    from darkframe.config import load_config

    config = load_config()
    uvicorn.run(create_app(), host="127.0.0.1", port=config.sky_engine_port, log_level="warning")
