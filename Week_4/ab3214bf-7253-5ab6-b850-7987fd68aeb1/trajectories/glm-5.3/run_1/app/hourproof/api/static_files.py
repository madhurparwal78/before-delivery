"""Static file serving for the SPA. The server never serves source files, the
run manifest, dependency folders or environment contents.
"""
from __future__ import annotations

from pathlib import Path

from starlette.responses import FileResponse, HTMLResponse, Response
from starlette.routing import Route

from .errors import not_found

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"

MEDIA_TYPES = {
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".woff2": "font/woff2",
    ".txt": "text/plain; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
}


async def _spa(request) -> Response:
    return HTMLResponse((STATIC_DIR / "index.html").read_bytes())


async def _static(request) -> Response:
    relative = request.path_params["path"]
    if ".." in relative.split("/"):
        return Response("Not found", status_code=404)
    target = (STATIC_DIR / relative).resolve()
    if not target.is_file() or target.parent != STATIC_DIR.resolve() and STATIC_DIR.resolve() not in target.parents:
        return Response("Not found", status_code=404)
    media = MEDIA_TYPES.get(target.suffix, "application/octet-stream")
    return FileResponse(target, media_type=media)


async def _api_fallback(request) -> Response:
    from .app import api_error_response
    return api_error_response(not_found())


def spa_routes() -> list[Route]:
    return [
        Route("/static/{path:path}", _static),
        Route("/api/{rest:path}", _api_fallback),
        Route("/{rest:path}", _spa),
        Route("/", _spa),
    ]
