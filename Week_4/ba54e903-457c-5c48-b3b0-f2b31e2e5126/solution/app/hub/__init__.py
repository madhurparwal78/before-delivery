"""Community Hub: a Flask application served by gunicorn, with PostgreSQL and Mailpit behind it."""

from __future__ import annotations

import logging
from importlib import import_module

from flask import Flask, Response, jsonify, request
from werkzeug.exceptions import HTTPException

from . import bootstrap, db, router
from .db import PoolTimeout
from .errors import ApiError, REFUSALS, refusal_response

log = logging.getLogger("hub")

# Every module that registers API routes (hub.router.route) or page routes (register(app)).
MODULES = ("health", "accounts", "communities", "roles", "invites", "messages", "notifications", "search", "live",
           "media", "billing", "trending", "safety", "support", "analytics", "sitemap", "art", "workspace", "pages")


def _server_error(status: int) -> Response:
    response = jsonify({"error": {"code": "server_error", "message": REFUSALS["server_error"][1], "field": None}})
    response.status_code = status
    return response


def create_app() -> Flask:
    app = Flask(__name__, template_folder="../templates", static_folder="../static", static_url_path="/static")
    app.url_map.merge_slashes = False
    app.config["JSON_AS_ASCII"] = False
    app.json.ensure_ascii = False
    app.json.sort_keys = False

    methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]
    for rule in ("/api", "/api/", "/api/<path:rest>"):
        app.add_url_rule(rule, "api_dispatch" + rule, router.dispatch, defaults=None if "<" in rule else {"rest": ""},
                         methods=methods, provide_automatic_options=False, strict_slashes=False)
    # An Upgrade: websocket GET goes through the same pipeline, so a foreign Origin answers 403, not a routing 404.
    app.add_url_rule("/api/<path:rest>", "api_dispatch_upgrade", router.dispatch, methods=["GET"],
                     provide_automatic_options=False, strict_slashes=False, websocket=True)

    pages = import_module("hub.pages")
    for name in MODULES:
        module = import_module(f"hub.{name}")
        if hasattr(module, "register"):
            module.register(app)

    @app.after_request
    def _headers(response: Response) -> Response:
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        if request.path == "/api" or request.path.startswith("/api/"):
            router.decorate(response)
        return response

    @app.errorhandler(ApiError)
    def _refusal(error: ApiError) -> Response:
        return refusal_response(error)

    @app.errorhandler(HTTPException)
    def _http(error: HTTPException) -> Response:
        if request.path == "/api" or request.path.startswith("/api/"):
            return refusal_response(ApiError("not_found"))
        return pages.not_found_page(404 if error.code in (404, 405) else error.code or 404)

    @app.errorhandler(Exception)
    def _unhandled(error: Exception) -> Response:
        log.exception("unhandled error")
        unavailable = isinstance(error, (PoolTimeout, db.Error))
        if request.path == "/api" or request.path.startswith("/api/"):
            return _server_error(503 if unavailable else 500)
        return pages.not_found_page(503 if unavailable else 500)

    bootstrap.start()
    return app
