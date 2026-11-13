"""The Northfall reference programme: one origin for the pages and the API."""

from __future__ import annotations

import logging

from flask import Flask, request
from werkzeug.exceptions import HTTPException

from . import db
from .api import auth, desk, enquiries, public
from .domain.fields import is_hostile
from .http import (
    METHOD_NOT_ALLOWED,
    NOT_FOUND,
    OUTAGE,
    TOO_LARGE,
    DatabaseUnavailable,
    Refusal,
    json_response,
    not_found,
)
from .pages import bp as pages_bp
from .pages.render import locale_of_path, outage_page, unknown_address_page

METHOD_ORDER = ("GET", "HEAD", "POST", "PUT", "PATCH", "DELETE")


def _is_api() -> bool:
    return request.path == "/api" or request.path.startswith("/api/")


def _allow(methods) -> str:
    listed = [name for name in METHOD_ORDER if name in set(methods or ())]
    return ", ".join(listed)


def create_app() -> Flask:
    logging.basicConfig(level=logging.INFO)
    app = Flask(__name__, static_url_path="/static")

    app.register_blueprint(public.bp)
    app.register_blueprint(enquiries.bp)
    app.register_blueprint(auth.bp)
    app.register_blueprint(desk.bp)
    app.register_blueprint(pages_bp)

    @app.before_request
    def _reject_hostile_path():
        if is_hostile(request.path):
            raise not_found()

    @app.errorhandler(Refusal)
    def _refusal(error: Refusal):
        """Pages only ever refuse with not found; the API uses both shapes."""
        if _is_api():
            return json_response(error.payload, error.status, error.headers)
        return unknown_address_page(locale_of_path(request.path))

    @app.errorhandler(404)
    def _missing(_error):
        if _is_api():
            return json_response(NOT_FOUND, 404)
        return unknown_address_page(locale_of_path(request.path))

    @app.errorhandler(405)
    def _wrong_method(error):
        headers = {"Allow": _allow(getattr(error, "valid_methods", ("GET", "HEAD")))}
        if _is_api():
            return json_response(METHOD_NOT_ALLOWED, 405, headers)
        headers["Content-Type"] = "text/plain; charset=utf-8"
        return "Method not allowed", 405, headers

    @app.errorhandler(413)
    def _too_large(_error):
        return json_response(TOO_LARGE, 413)

    @app.errorhandler(DatabaseUnavailable)
    def _unavailable(_error):
        if _is_api():
            return json_response(OUTAGE, 503)
        return outage_page(locale_of_path(request.path))

    @app.errorhandler(Exception)
    def _unexpected(error):
        if isinstance(error, HTTPException):
            return error
        app.logger.exception("request failed")
        if _is_api():
            return json_response(OUTAGE, 503)
        return outage_page(locale_of_path(request.path))

    @app.after_request
    def _no_sniff(response):
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "same-origin")
        return response

    db.start()
    return app
