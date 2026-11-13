"""The ASGI application: API routes, pages, static files and the shared error handling."""

import mimetypes
from contextlib import asynccontextmanager
from pathlib import Path

from starlette.applications import Starlette
from starlette.exceptions import HTTPException
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Mount
from starlette.staticfiles import StaticFiles

from . import db, pages, seed
from .config import load_settings
from .errors import ApiError, api_error_response, http_error_body, is_api
from .routes import accounts, activities, challenges, feed, segments, social, stats, subscription

ROOT = Path(__file__).resolve().parent.parent

for media_type, suffix in (("audio/ogg", ".ogg"), ("video/webm", ".webm"), ("font/woff2", ".woff2"),
                           ("text/javascript", ".js")):
    mimetypes.add_type(media_type, suffix)


@asynccontextmanager
async def lifespan(app: Starlette):
    await db.open_pool(load_settings())
    async with db.pool.acquire() as conn, conn.transaction():
        await seed.seed(conn)
    yield
    await db.close_pool()


class SecurityHeaders(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        return response


async def http_error(request: Request, exc: HTTPException):
    if is_api(request):
        return JSONResponse(http_error_body(exc), status_code=exc.status_code, headers=exc.headers)
    if exc.status_code == 404:
        return pages.not_found_page(request)
    return JSONResponse(http_error_body(exc), status_code=exc.status_code, headers=exc.headers)


async def server_error(request: Request, exc: Exception):
    return JSONResponse({"error": "internal_error"}, status_code=500)


app = Starlette(
    routes=[
        *accounts.routes, *activities.routes, *segments.routes, *social.routes, *feed.routes,
        *challenges.routes, *stats.routes, *subscription.routes, *pages.routes,
        Mount("/static", StaticFiles(directory=ROOT / "static"), name="static"),
        Mount("/assets", StaticFiles(directory=ROOT / "assets"), name="assets"),
    ],
    exception_handlers={ApiError: api_error_response, HTTPException: http_error, Exception: server_error},
    lifespan=lifespan,
)
app.add_middleware(SecurityHeaders)
