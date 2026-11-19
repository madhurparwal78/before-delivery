"""The built static assets the pages reference, served from the app's own origin."""

from __future__ import annotations

import mimetypes
from pathlib import Path
from typing import Sequence

from starlette.requests import Request
from starlette.responses import FileResponse, Response

ROOT = Path(__file__).parent / "static"
TYPES = {
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".png": "image/png",
    ".webm": "video/webm",
    ".ogg": "audio/ogg",
    ".ico": "image/x-icon",
    ".svg": "image/svg+xml",
}


def static_response(parts: Sequence[str], request: Request, *, head: bool = False) -> Response:
    from .pages import not_found_page

    if not parts or any(part in ("", ".", "..") for part in parts):
        return not_found_page()
    path = ROOT.joinpath(*parts).resolve()
    if not path.is_file() or ROOT.resolve() not in path.parents:
        return not_found_page()
    media_type = TYPES.get(path.suffix) or mimetypes.guess_type(path.name)[0]
    response = FileResponse(
        path,
        media_type=media_type or "application/octet-stream",
        headers={"Cache-Control": "public, max-age=3600"},
        method="HEAD" if head else "GET",
    )
    return response
