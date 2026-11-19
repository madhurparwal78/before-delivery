"""Serves only the built browser files, the fonts and three.js."""

from __future__ import annotations

from pathlib import Path

from starlette.requests import Request
from starlette.responses import FileResponse, Response

BUILT_ROOT = Path(__file__).resolve().parent.parent.parent / "static"
SCREEN_PATHS = (
    "/",
    "/unlock",
    "/plan",
    "/projects",
    "/sessions",
    "/library",
    "/site",
)
MEDIA_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".woff2": "font/woff2",
    ".svg": "image/svg+xml",
    ".json": "application/json",
}


def _is_screen(path: str) -> bool:
    if path in SCREEN_PATHS:
        return True
    return path.startswith("/projects/") or path.startswith("/s/")


async def serve(request: Request) -> Response:
    path = request.url.path
    if _is_screen(path):
        return _file(BUILT_ROOT / "index.html")
    candidate = (BUILT_ROOT / path.lstrip("/")).resolve()
    if (
        candidate.is_file()
        and BUILT_ROOT in candidate.parents
        and candidate.name != "index.html"
    ):
        return _file(candidate)
    return Response("Not found", status_code=404, media_type="text/plain")


def _file(path: Path) -> Response:
    return FileResponse(
        path,
        media_type=MEDIA_TYPES.get(path.suffix, "application/octet-stream"),
        headers={"Cache-Control": "no-cache"},
    )
