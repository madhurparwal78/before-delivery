"""The Wayline application: one origin for the pages and the JSON interface."""

from __future__ import annotations

import json
import logging
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
import asyncpg
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from .boundary import Boundary
from .db import database
from .errors import ApiError
from .idempotency import clear_in_flight
from .routes import auth, builder, catalog, connections, data, jobs, pages, workspace
from .schema import create_schema
from .security import load_master_key
from .seed import run_seed
from .sync import recover_interrupted_jobs, stop_runners
from .warehouse import drop_orphan_schemas

logging.basicConfig(level=logging.INFO, format="%(message)s", stream=sys.stdout)


async def prepare(pool: asyncpg.Pool) -> None:
    """Create the schema, seed, and fail interrupted jobs before health answers 200."""
    await create_schema(pool)
    async with pool.acquire() as conn:
        await load_master_key(conn)
        await drop_orphan_schemas(conn)
        await run_seed(conn)
    await clear_in_flight(pool)
    await recover_interrupted_jobs(pool)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    database.start(prepare)
    yield
    await stop_runners()
    await database.stop()


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
app.router.redirect_slashes = False
app.add_middleware(Boundary)

for module in (auth, workspace, catalog, data, connections, jobs, builder):
    app.include_router(module.router)
app.include_router(pages.router)


@app.exception_handler(ApiError)
async def api_error_handler(request: Request, error: ApiError) -> JSONResponse:
    return JSONResponse(
        error.body(request.state.request_id), status_code=error.status, headers=error.headers
    )


@app.exception_handler(Exception)
async def unexpected_error_handler(request: Request, error: Exception) -> JSONResponse:
    request_id = request.state.request_id
    sys.stdout.write(
        json.dumps({"request_id": request_id, "level": "error", "message": type(error).__name__}) + "\n"
    )
    sys.stdout.flush()
    return JSONResponse({"error": "service_unavailable", "request_id": request_id}, status_code=503)


__all__ = ["app"]
