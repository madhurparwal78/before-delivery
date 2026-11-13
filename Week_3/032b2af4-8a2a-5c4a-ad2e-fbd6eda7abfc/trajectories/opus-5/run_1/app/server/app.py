"""The Pacely ASGI application: pages, assets and the JSON interface on one origin."""
import json
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import db, pages, seed
from .api import accounts, activities, challenges, segments, social
from .config import MAX_BODY_BYTES
from .errors import ApiError

ROOT = Path(__file__).resolve().parent.parent
CAPTIONS = """WEBVTT

00:00:00.000 --> 00:00:08.000
Riders set off together from the start line.
"""


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.pool.open(wait=True, timeout=30)
    db.create_schema()
    seed.seed()
    yield
    db.pool.close()


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


class BodyLimit:
    """Refuses an oversized /api body before any route reads it."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope["path"].startswith("/api"):
            return await self.app(scope, receive, send)
        chunks: list[bytes] = []
        size = 0
        more = True
        while more:
            message = await receive()
            if message["type"] != "http.request":
                break
            chunks.append(message.get("body", b""))
            size += len(chunks[-1])
            more = message.get("more_body", False)
            if size > MAX_BODY_BYTES:
                body = json.dumps({"error": "payload_too_large"}).encode()
                await send(
                    {
                        "type": "http.response.start",
                        "status": 413,
                        "headers": [
                            (b"content-type", b"application/json"),
                            (b"content-length", str(len(body)).encode()),
                        ],
                    }
                )
                await send({"type": "http.response.body", "body": body})
                return
        payload = b"".join(chunks)
        sent = False

        async def replay():
            nonlocal sent
            if sent:
                return {"type": "http.disconnect"}
            sent = True
            return {"type": "http.request", "body": payload, "more_body": False}

        return await self.app(scope, replay, send)


@app.exception_handler(ApiError)
async def api_error(request: Request, exc: ApiError):
    return exc.response()


@app.exception_handler(StarletteHTTPException)
async def http_error(request: Request, exc: StarletteHTTPException):
    if request.url.path.startswith("/api"):
        names = {400: "validation", 401: "unauthorized", 403: "forbidden", 404: "not_found", 405: "not_found"}
        return JSONResponse({"error": names.get(exc.status_code, "request_failed")}, status_code=exc.status_code)
    if exc.status_code == 404:
        return pages.not_found_page(request)
    return Response(status_code=exc.status_code)


@app.exception_handler(Exception)
async def unexpected_error(request: Request, exc: Exception):
    if request.url.path.startswith("/api"):
        return JSONResponse({"error": "server_error"}, status_code=500)
    return Response("Something went wrong.", status_code=500, media_type="text/plain")


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.api_route("/media/hero.vtt", methods=["GET", "HEAD"])
def hero_captions():
    return Response(CAPTIONS, media_type="text/vtt")


for router in (accounts.router, activities.router, social.router, segments.router, challenges.router):
    app.include_router(router, prefix="/api")

app.include_router(pages.router)
app.mount("/assets", StaticFiles(directory=ROOT / "assets"), name="assets")
app.mount("/static", StaticFiles(directory=ROOT / "server" / "web" / "static"), name="static")


@app.get("/favicon.ico")
def favicon():
    return FileResponse(ROOT / "server" / "web" / "static" / "img" / "mark.svg", media_type="image/svg+xml")


app.add_middleware(BodyLimit)
