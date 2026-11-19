"""The pages this app serves, its built assets and its media, all without the database."""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, Response

from ..config import DIST_DIR, FILM_FILE
from ..media import captions_vtt, chapters_vtt
from ..published import is_page_path

router = APIRouter()

_RANGE = re.compile(r"^bytes=(\d*)-(\d*)$")
ASSET_DIRECTORIES = ("assets", "fonts")
CONTENT_TYPES = {
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".woff2": "font/woff2",
    ".svg": "image/svg+xml",
    ".webmanifest": "application/manifest+json",
}


@lru_cache(maxsize=1)
def _index_html() -> str:
    return (DIST_DIR / "index.html").read_text(encoding="utf-8")


@lru_cache(maxsize=1)
def _prerendered() -> dict[str, str]:
    return json.loads((DIST_DIR / "prerender.json").read_text(encoding="utf-8"))


def page_response(path: str, status: int) -> Response:
    """The page shell, with this route's markup already in it so its copy needs no scripts."""
    fragments = _prerendered()
    if path in fragments:
        markup = fragments[path]
    elif status == 200:
        markup = fragments["__console__"]
    else:
        markup = fragments["__not_found__"]
    html = _index_html().replace('<div id="root"></div>', f'<div id="root">{markup}</div>')
    return Response(html, status_code=status, media_type="text/html; charset=utf-8")


@router.get("/media/data-in-sound.webm")
async def film(request: Request) -> Response:
    data = FILM_FILE.read_bytes()
    range_header = request.headers.get("range")
    match = _RANGE.match(range_header) if range_header else None
    if match is None:
        return Response(
            data,
            media_type="video/webm",
            headers={"Accept-Ranges": "bytes", "Content-Length": str(len(data))},
        )
    start = int(match.group(1)) if match.group(1) else 0
    end = int(match.group(2)) if match.group(2) else len(data) - 1
    end = min(end, len(data) - 1)
    chunk = data[start : end + 1]
    return Response(
        chunk,
        status_code=206,
        media_type="video/webm",
        headers={
            "Accept-Ranges": "bytes",
            "Content-Range": f"bytes {start}-{end}/{len(data)}",
            "Content-Length": str(len(chunk)),
        },
    )


@router.get("/media/data-in-sound.en.vtt")
async def captions() -> Response:
    return Response(captions_vtt(), media_type="text/vtt; charset=utf-8")


@router.get("/media/data-in-sound.chapters.vtt")
async def chapters() -> Response:
    return Response(chapters_vtt(), media_type="text/vtt; charset=utf-8")


@router.get("/{full_path:path}")
async def page(request: Request, full_path: str) -> Any:
    path = "/" + full_path
    asset = _asset_file(full_path)
    if asset is not None:
        return FileResponse(
            asset,
            media_type=CONTENT_TYPES.get(asset.suffix, "application/octet-stream"),
            headers={"Cache-Control": "public, max-age=31536000, immutable"},
        )
    if is_page_path(path):
        return page_response(path, 200)
    return page_response(path, 404)


def _asset_file(full_path: str) -> Path | None:
    parts = full_path.split("/")
    if len(parts) < 2 or parts[0] not in ASSET_DIRECTORIES or any(part in ("", ".", "..") for part in parts):
        return None
    candidate = DIST_DIR.joinpath(*parts)
    if candidate.is_file():
        return candidate
    return None
