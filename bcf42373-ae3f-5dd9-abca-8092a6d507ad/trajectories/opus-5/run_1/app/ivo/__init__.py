"""The Ivo Kastrel casebook: a server-rendered site over one PostgreSQL store."""

import logging

from flask import Flask, render_template, request
from markupsafe import Markup, escape
from werkzeug.exceptions import HTTPException

from . import copy, errors, visuals
from .api import api
from .config import MAX_BODY_BYTES
from .db import DatabaseUnavailable, database
from .errors import ApiError, json_refusal
from .pages import pages

HTTP_REASONS = {
    400: errors.NOT_A_JSON_OBJECT,
    404: errors.NOT_FOUND,
    405: errors.METHOD_NOT_ALLOWED,
    413: errors.BODY_TOO_LARGE,
    415: errors.UNSUPPORTED_MEDIA_TYPE,
}

logger = logging.getLogger(__name__)


def create_app():
    app = Flask(__name__, static_url_path="/static")
    app.config["MAX_CONTENT_LENGTH"] = MAX_BODY_BYTES
    app.config["JSON_SORT_KEYS"] = False
    app.url_map.merge_slashes = False
    app.jinja_env.trim_blocks = True
    app.jinja_env.lstrip_blocks = True
    app.jinja_env.finalize = _keep_apostrophes

    app.register_blueprint(pages)
    app.register_blueprint(api)

    app.jinja_env.globals.update(copy=copy, visuals=visuals)
    app.jinja_env.filters["calendar_date"] = copy.calendar_date

    @app.before_request
    def refuse_uncanonical_or_oversized():
        """Exact addresses only, and bodies are refused before being parsed."""
        raw = request.environ.get("RAW_URI") or request.environ.get("REQUEST_URI")
        if raw is not None and "%" in raw.split("?", 1)[0]:
            raise ApiError(404, errors.NOT_FOUND)
        if request.path.startswith("/api"):
            length = request.content_length
            if length is not None and length > MAX_BODY_BYTES:
                raise ApiError(413, errors.BODY_TOO_LARGE)

    @app.errorhandler(ApiError)
    def handle_api_error(error):
        return _answer(error)

    @app.errorhandler(HTTPException)
    def handle_http_exception(exception):
        headers = {}
        if exception.code == 405:
            headers["Allow"] = ", ".join(sorted(exception.valid_methods or ()))
        reason = HTTP_REASONS.get(exception.code, errors.INTERNAL_ERROR)
        return _answer(ApiError(exception.code or 500, reason, headers=headers))

    @app.errorhandler(DatabaseUnavailable)
    def handle_outage(error):
        logger.warning("PostgreSQL unreachable: %s", error)
        return _answer(ApiError(503, errors.SERVICE_UNAVAILABLE))

    @app.errorhandler(Exception)
    def handle_unexpected(error):
        logger.exception("Unexpected failure", exc_info=error)
        return _answer(ApiError(500, errors.INTERNAL_ERROR))

    try:
        database.prepare()
    except DatabaseUnavailable as error:
        logger.warning("Deferring schema and seed: %s", error)

    return app


def _keep_apostrophes(value):
    """Escape as usual, but leave the apostrophe as itself.

    The site's copy is full of apostrophes and every attribute in the
    templates is double-quoted, so a literal apostrophe is safe in both text
    and attribute positions.
    """
    if type(value) is str:
        return Markup(str(escape(value)).replace("&#39;", "'"))
    return value


def _answer(error):
    """One refusal, rendered as JSON under /api and as a page elsewhere."""
    if request.path.startswith("/api"):
        return json_refusal(error)
    if error.status == 503:
        template, title = "offline.html", copy.OFFLINE_TITLE
    else:
        template, title = "not_found.html", copy.NOT_FOUND_TITLE
    body = render_template(template, page_title=title)
    return body, error.status, {"Content-Type": "text/html; charset=utf-8", **error.headers}
