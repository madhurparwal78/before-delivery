"""Serve the app: pages, static assets and the /api pipeline."""
from __future__ import annotations

import os

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse, Response
from starlette.routing import Route, Mount
from starlette.staticfiles import StaticFiles

from .config import Config
from .server import App as WardlineApp, api_dispatch

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
TEMPLATES_DIR = os.path.join(os.path.dirname(__file__), "templates")

DOCKET_ROUTES = ("/compartments", "/compartments/", "/exhibits/", "/releases/", "/intake", "/reviews")
AUDITOR_ROUTES = ("/ledger", "/ledger/review", "/audit/chain")

BLOCKED_FILES = ("/.env", "/run.json", "/.git/config")


async def page(request: Request) -> Response:
    path = request.url.path
    if any(path.startswith(blocked) for blocked in BLOCKED_FILES) or path.endswith(".py"):
        return not_found_page()
    if path.startswith("/l/"):
        return serve_file("link.html")
    if path == "/sign-in":
        return serve_file("sign-in.html")
    if path == "/favicon.ico":
        return Response(status_code=404)
    if path.startswith(DOCKET_ROUTES) or path in AUDITOR_ROUTES or path == "/compartments":
        return serve_file("app.html")
    if path.startswith("/static/"):
        return Response(status_code=404)
    return not_found_page()


def not_found_page() -> Response:
    return serve_file("not-found.html", status_code=404)


def serve_file(name: str, status_code: int = 200) -> Response:
    full = os.path.join(STATIC_DIR, name)
    if not os.path.isfile(full):
        return Response("Nothing to show at this address.", status_code=404)
    return FileResponse(full, status_code=status_code)


def create_app(cfg: Config | None = None) -> Starlette:
    cfg = cfg or Config.from_env()
    wardline = WardlineApp(cfg)
    wardline.start()

    app = Starlette(routes=[
        Route("/api/{rest:path}", api_dispatch, methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]),
        Mount("/static", app=StaticFiles(directory=STATIC_DIR), name="static"),
        Route("/{rest:path}", page, methods=["GET", "HEAD"]),
    ])
    app.state.wardline = wardline
    return app


app = None


def main() -> None:
    import uvicorn

    global app
    cfg = Config.from_env()
    app = create_app(cfg)
    uvicorn.run(app, host="0.0.0.0", port=cfg.app_public_port, log_level="warning")


if __name__ == "__main__":
    main()

