"""The Starlette application: routing table, error envelope, security boundary."""
from __future__ import annotations

import asyncio
import datetime as _dt
import json
import re
import traceback
from typing import Optional

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route
from starlette.staticfiles import StaticFiles
from starlette.middleware import Middleware
from starlette.middleware.base import BaseHTTPMiddleware

from . import api
from .config import Config, load_config
from .db import Database
from .errors import ApiError, ERROR_MESSAGES, method_not_allowed, dumps
from .live import LiveHub
from .mail import Mailer

ID_RE = re.compile(r"^[1-9][0-9]{0,9}$")


class AppState:
    def __init__(self, config: Config) -> None:
        self.config = config
        self.db = Database(config)
        self.mailer = Mailer(config)
        self.live = LiveHub(config, self.db)
        self.mailer.bind(self.db)


def parse_id(raw: str) -> Optional[int]:
    if not ID_RE.fullmatch(raw or ""):
        return None
    value = int(raw)
    if value > 2147483647:
        return None
    return value


class ErrorEnvelopeMiddleware(BaseHTTPMiddleware):
    """One shared helper builds every refused request's body, including framework errors."""

    async def dispatch(self, request: Request, call_next):
        try:
            response = await call_next(request)
            return response
        except ApiError as err:
            return self._error_response(request, err)
        except Exception:
            traceback.print_exc()
            return self._error_response(request, ApiError("not_found"))

    def _error_response(self, request: Request, err: ApiError) -> Response:
        path = request.url.path
        if path.startswith("/api") or path.startswith("/media"):
            body = dumps(err.body())
            headers = {"Content-Type": "application/json"}
            headers.update(err.response_headers())
            if path.startswith("/api"):
                headers["Cache-Control"] = "no-store"
                headers["Vary"] = "Authorization"
            return Response(body, status_code=err.status, headers=headers)
        if err.status == 404:
            from . import pages as pages_mod
            from jinja2 import Environment, FileSystemLoader, select_autoescape
            env = Environment(loader=FileSystemLoader("/app/hub/templates"),
                              autoescape=select_autoescape(["html"]))
            html = env.get_template("notfound.html").render(app_url="", member=None, locale="en-US")
            return Response(html, status_code=404, media_type="text/html")
        return Response("Not found", status_code=err.status)


def build_app(config: Config) -> Starlette:
    from . import pages

    state = AppState(config)
    app = Starlette(
        routes=pages.build_routes(state),
        middleware=[Middleware(ErrorEnvelopeMiddleware)],
    )
    app.state.hub = state
    app.add_event_handler("startup", _on_startup)
    return app


async def _on_startup() -> None:
    """Deferred to the app so the database can be down at boot."""
    pass


def create_app() -> Starlette:
    return build_app(load_config())
