"""The Flask application: server boundary, static assets and the API."""

from __future__ import annotations

from pathlib import Path

from flask import Flask, Response, request, send_from_directory
from werkzeug.exceptions import HTTPException

from .api import register_api
from .errors import ApiError
from .responses import api_response

STATIC_DIR = Path(__file__).with_name("static")
MAX_JSON_BYTES = 65_536
MAX_UPLOAD_BYTES = 5_100_000
WRITE_METHODS = frozenset({"POST", "PATCH", "PUT", "DELETE"})

SPA_ROUTES = (
    "/",
    "/sign-in",
    "/shifts",
    "/leave",
    "/leave/new",
    "/leave/<leave_id>",
    "/sickness",
    "/sickness/<sickness_id>",
    "/rota",
    "/cover",
    "/accrual",
    "/queue",
    "/today",
    "/floors",
    "/attendance",
    "/pay-periods",
    "/exports",
    "/audit",
    "/profile",
)


def _shell(**_parameters) -> Response:
    response = send_from_directory(STATIC_DIR, "index.html")
    response.headers["Cache-Control"] = "no-store"
    return response


def _body_limit() -> int:
    is_upload = request.method == "POST" and request.path.endswith("/fit-note")
    return MAX_UPLOAD_BYTES if is_upload else MAX_JSON_BYTES


def create_app() -> Flask:
    app = Flask(__name__, static_folder=None)

    @app.before_request
    def guard_boundary():
        """Same-origin writes only, and bodies within the published limits."""
        origin = request.headers.get("Origin")
        if request.method in WRITE_METHODS and origin:
            if origin != f"{request.scheme}://{request.host}":
                raise ApiError("cross_origin")
        length = request.content_length
        if length is not None and length > _body_limit():
            raise ApiError("too_large")
        return None

    @app.errorhandler(ApiError)
    def handle_api_error(error: ApiError):
        return api_response(error.body(), error.status)

    @app.errorhandler(HTTPException)
    def handle_http_error(error: HTTPException):
        if request.path.startswith("/api/"):
            return api_response(ApiError("not_found").body(), 404)
        return Response("Not found", status=error.code or 404, mimetype="text/plain")

    register_api(app)

    @app.get("/assets/<path:name>")
    def assets(name: str):
        return send_from_directory(STATIC_DIR, name)

    for route in SPA_ROUTES:
        app.add_url_rule(route, f"shell:{route}", _shell)

    return app
