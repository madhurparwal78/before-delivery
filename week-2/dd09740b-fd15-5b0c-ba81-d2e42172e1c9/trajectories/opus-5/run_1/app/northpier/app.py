"""The Flask application: one origin for the pages and the API."""

from __future__ import annotations

import logging

from flask import Flask, Response, request
from werkzeug.exceptions import HTTPException

from . import errors, mailer
from .api import api
from .db import DATABASE, Database
from .http_support import JSON_CONTENT_TYPE, is_status_address, refusal_response
from .pages import pages, render_not_found, render_outage
from .seed import seed
from .validation import MAX_BODY_BYTES

log = logging.getLogger("northpier")

#: Generous ceiling so Werkzeug never buffers an unbounded body; the desk's own
#: limit of 65,536 bytes is applied before any handler runs.
HARD_BODY_CEILING = 1_048_576


def _prepare(database: Database) -> None:
    database.apply_schema()
    with database.connection() as conn:
        seed(conn)


def create_app() -> Flask:
    app = Flask(__name__, static_folder="static", static_url_path="/static")
    app.config["MAX_CONTENT_LENGTH"] = HARD_BODY_CEILING
    app.url_map.strict_slashes = False
    app.jinja_env.trim_blocks = True
    app.jinja_env.lstrip_blocks = True

    app.register_blueprint(api)
    app.register_blueprint(pages)

    @app.before_request
    def guard_status_addresses() -> Response | None:
        """Refusal order 1: a status address only reads, whatever else is wrong."""
        if request.method not in ("GET", "HEAD") and is_status_address(request.path):
            return refusal_response(errors.method_not_allowed())
        return None

    @app.before_request
    def guard_body_size() -> Response | None:
        """Refusal order 2: the body limit, before sign-in and before any lookup."""
        if request.method not in ("POST", "PUT", "PATCH", "DELETE"):
            return None
        length = request.content_length
        if length is not None and length > MAX_BODY_BYTES:
            return refusal_response(errors.body_too_large())
        if len(request.get_data(cache=True)) > MAX_BODY_BYTES:
            return refusal_response(errors.body_too_large())
        return None

    @app.after_request
    def no_store_on_api(response: Response) -> Response:
        if request.path.startswith("/api/"):
            response.headers.setdefault("Cache-Control", "no-store")
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "same-origin")
        return response

    @app.errorhandler(errors.Refusal)
    def handle_refusal(refusal: errors.Refusal) -> Response:
        if refusal.status == 503 and not _wants_json():
            return render_outage()
        if refusal.status == 404 and not _wants_json():
            return render_not_found()
        return refusal_response(refusal)

    @app.errorhandler(HTTPException)
    def handle_http_exception(exc: HTTPException) -> Response:
        status = exc.code or 500
        if status == 413:
            return refusal_response(errors.body_too_large())
        if status == 405:
            return refusal_response(errors.method_not_allowed())
        if status == 404:
            return handle_refusal(errors.not_found())
        if status == 400:
            return refusal_response(errors.invalid_body())
        if status >= 500:
            return handle_refusal(errors.database_unavailable())
        return handle_refusal(errors.not_found())

    @app.errorhandler(Exception)
    def handle_unexpected(exc: Exception) -> Response:
        # Nothing may surface as a crash: the desk answers with its outage refusal
        # and the detail stays in the server log.
        log.exception("unhandled request failure: %s", exc)
        return handle_refusal(errors.database_unavailable())

    return app


def _wants_json() -> bool:
    if request.path.startswith("/api/"):
        return True
    accept = request.headers.get("Accept", "")
    return JSON_CONTENT_TYPE.split(";")[0] in accept and "text/html" not in accept


def start_background_work() -> None:
    DATABASE.start(_prepare)
    mailer.start_sender()
