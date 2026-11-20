"""The ASGI application: API routes, the browser app, error handlers and the background workers."""

from contextlib import asynccontextmanager

from starlette.applications import Starlette
from starlette.exceptions import HTTPException
from starlette.routing import Route

from . import db, workers
from .errors import ApiError
from .routes import (  # noqa: F401 -- importing a routes module registers its endpoints in ROUTES
    accrual,
    admin,
    attendance,
    audit,
    clocking,
    cover,
    exports,
    leave,
    queue,
    rota,
    session,
    sickness,
)
from .web import ROUTES, api_error, browser_app, http_error


@asynccontextmanager
async def lifespan(_: Starlette):
    await db.connect()
    await workers.probe_services()
    workers.start()
    yield
    await workers.stop()
    await db.close()


app = Starlette(
    routes=[*ROUTES, Route("/{path:path}", browser_app, methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"])],
    exception_handlers={ApiError: api_error, HTTPException: http_error},
    lifespan=lifespan,
)
