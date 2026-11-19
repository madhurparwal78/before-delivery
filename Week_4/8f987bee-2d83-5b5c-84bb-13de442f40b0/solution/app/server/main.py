"""The Wayline server: one origin for the pages and the JSON interface."""

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from . import lifecycle, seed
from .config import settings
from .db import UNAVAILABLE, Database, db, utcnow
from .errors import ApiError, error_response, not_ready_response, render
from .middleware import Gateway, log_line
from .routes import auth, builder, catalog, connections, jobs, public, workspace
from .views import Health


async def prepare(database: Database) -> None:
    """Seed once and fail every job a previous run left active, before health answers 200."""
    started = utcnow()
    async with database.transaction() as conn:
        await seed.run(conn)
        await lifecycle.recover(conn, started)


@asynccontextmanager
async def lifespan(_: FastAPI):
    log_line({"event": "starting", "port": settings.public_port, "public_url": settings.public_url})
    startup = asyncio.create_task(db.start(prepare))
    yield
    startup.cancel()


app = FastAPI(lifespan=lifespan, openapi_url=None, docs_url=None, redoc_url=None, redirect_slashes=False)


@app.exception_handler(ApiError)
async def refused(request: Request, error: ApiError) -> JSONResponse:
    return render(request.scope["wayline.request_id"], error)


async def unavailable(request: Request, _: Exception) -> JSONResponse:
    return error_response(request.scope["wayline.request_id"], 503, "service_unavailable")


for kind in UNAVAILABLE:
    app.add_exception_handler(kind, unavailable)


@app.get("/api/health", response_model=Health)
async def health(request: Request) -> JSONResponse:
    if await db.alive():
        return JSONResponse({"status": "ok"})
    return not_ready_response(request.scope["wayline.request_id"])


for module in (auth, workspace, catalog, connections, jobs, builder):
    app.include_router(module.router)
app.mount("/assets", StaticFiles(directory=public.CLIENT / "assets", check_dir=False), name="assets")
app.mount("/fonts", StaticFiles(directory=public.CLIENT / "fonts", check_dir=False), name="fonts")
app.include_router(public.router)
app.add_middleware(Gateway)
