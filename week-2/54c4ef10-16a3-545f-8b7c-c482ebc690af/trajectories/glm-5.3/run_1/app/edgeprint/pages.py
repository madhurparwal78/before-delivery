"""Pages: the app shell, served same-origin, with signed-out redirects."""
from __future__ import annotations

import os
from urllib.parse import quote

from starlette.requests import Request
from starlette.responses import HTMLResponse, RedirectResponse, Response
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles

from .server import SESSION_COOKIE

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")

SHELL = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Edgeprint</title>
<link rel="stylesheet" href="/static/app.css">
<script defer src="/static/js/exposure.js"></script>
<script defer src="/static/js/ui.js"></script>
<script defer src="/static/js/screens.js"></script>
<script defer src="/static/js/rollscreen.js"></script>
<script defer src="/static/js/workspace.js"></script>
<script defer src="/static/js/logscreen.js"></script>
<script defer src="/static/js/app.js"></script>
</head>
<body>
<div id="root"></div>
<noscript>Edgeprint needs JavaScript.</noscript>
</body>
</html>
"""


def _signed_in(request: Request, state) -> bool:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return False
    return state.app_state.session_account(token) is not None


async def landing(request: Request) -> Response:
    return HTMLResponse(SHELL)


async def any_page(request: Request) -> Response:
    """Signed-out visits redirect to /signin?next=<path and query>."""
    state = request.app.state
    if _signed_in(request, state):
        return HTMLResponse(SHELL)
    target = request.url.path
    if request.url.query:
        target += "?" + request.url.query
    return RedirectResponse(f"/signin?next={quote(target, safe='')}", status_code=307)


async def not_found_page(request: Request) -> Response:
    return HTMLResponse(SHELL, status_code=404)


async def font_file(request: Request) -> Response:
    path = os.path.join(STATIC_DIR, "fonts", "HostGrotesk.ttf")
    return Response(open(path, "rb").read(), media_type="font/ttf",
                    headers={"Cache-Control": "public, max-age=31536000"})


def page_routes() -> list:
    return [
        Route("/", landing, methods=["GET"]),
        Route("/signin", landing, methods=["GET"]),
        Route("/signup", landing, methods=["GET"]),
        Route("/static/fonts/HostGrotesk.ttf", font_file, methods=["GET"]),
        Mount("/static", app=StaticFiles(directory=STATIC_DIR), name="static"),
        Route("/{rest:path}", any_page, methods=["GET"]),
    ]
