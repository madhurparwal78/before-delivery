"""Everything outside /api: the sandbox, the film and its tracks, the built assets and the pages."""

import re
from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response

from .. import sandbox

router = APIRouter()
ROOT = Path(__file__).resolve().parents[2]
CLIENT = ROOT / "dist" / "client"
PAGES = ROOT / "dist" / "pages"
FILM = ROOT / "assets" / "data-sonification-black-hole-at-the-center-of-the-perse-c38f6693.webm"
TRACKS = {"data-in-sound.en.vtt", "data-in-sound.chapters.vtt"}
PRERENDERED = {
    "/": "home", "/connectors": "connectors", "/pricing": "pricing", "/connector-builder": "connector-builder",
    "/data-replication": "data-replication", "/hybrid": "hybrid", "/mcp": "mcp", "/context-layer": "context-layer",
    "/why-open-source": "why-open-source", "/compare": "compare",
    "/data-engineering-resources": "data-engineering-resources", "/signin": "signin",
}
CLIENT_ROUTES = re.compile(
    r"^/(login|accept-invite|app|app/(connections/new|sources|destinations|builder|members|audit|settings)"
    r"|app/connections/[^/]+|app/destinations/[^/]+/tables/[^/]+)$")


@router.get("/mock-api/{rest:path}")
async def mock_api(rest: str, request: Request) -> JSONResponse:
    headers = {key.lower(): value for key, value in request.headers.items()}
    status, body = sandbox.answer("/mock-api/" + rest, headers, request.query_params.get("page"),
                                  request.query_params.get("page_size"))
    return JSONResponse(body, status_code=status)


@router.get("/media/data-in-sound.webm")
async def film() -> FileResponse:
    return FileResponse(FILM, media_type="video/webm")


@router.get("/media/{name}")
async def track(name: str) -> Response:
    if name not in TRACKS:
        return not_found_page()
    return FileResponse(CLIENT / "media" / name, media_type="text/vtt; charset=utf-8")


def not_found_page() -> HTMLResponse:
    return HTMLResponse((PAGES / "not-found.html").read_text(), status_code=404)


@router.get("/{path:path}")
async def page(path: str) -> Response:
    address = "/" + path
    if address in PRERENDERED:
        return HTMLResponse((PAGES / f"{PRERENDERED[address]}.html").read_text())
    if CLIENT_ROUTES.match(address):
        return HTMLResponse((CLIENT / "index.html").read_text(), headers={"Cache-Control": "no-store"})
    return not_found_page()
