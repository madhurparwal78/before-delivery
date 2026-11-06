"""The Mela Flask application."""

import hashlib
from urllib.parse import urlsplit

from flask import Flask, render_template, request
from werkzeug.exceptions import HTTPException

from . import api, auth, db, pages
from .api import api_json
from .errors import MelaError

PRIVATE_PAGE_ENDPOINTS = {"pages.home", "pages.manage", "pages.event_page"}
PRIVATE_API_PREFIXES = ("/api/me", "/api/events")
UNSAFE_METHODS = ("POST", "PUT", "PATCH", "DELETE")

STATUS_WORDS = {
    "pending": "Pending",
    "approved": "Going",
    "waitlisted": "Waitlist",
    "declined": "Declined",
    "cancelled": "Cancelled",
}


def _wants_json() -> bool:
    return request.path == "/api" or request.path.startswith("/api/")


def _needs_private_cache() -> bool:
    if request.path.startswith(PRIVATE_API_PREFIXES):
        return True
    return request.endpoint in PRIVATE_PAGE_ENDPOINTS


def _error_response(error: MelaError):
    if _wants_json():
        return api_json(error.body, error.status, error.headers)
    template = "not_found.html" if error.status == 404 else "outage.html"
    return (
        render_template(template, retry_path=request.full_path.rstrip("?")),
        error.status,
        error.headers,
    )


def create_app() -> Flask:
    app = Flask(__name__)
    app.register_blueprint(api.bp)
    app.register_blueprint(pages.bp)

    app.jinja_env.filters["initials"] = auth.avatar_initials
    app.jinja_env.filters["cover_id"] = _cover_id
    app.jinja_env.filters["status_word"] = STATUS_WORDS.get

    @app.before_request
    def _prepare():
        db.start_keeper()
        origin = request.headers.get("Origin")
        if request.method in UNSAFE_METHODS and origin:
            if urlsplit(origin).netloc != request.host:
                return _error_response(MelaError(403, "forbidden"))
        return None

    @app.after_request
    def _headers(response):
        if _needs_private_cache():
            response.headers["Cache-Control"] = "private, no-store"
            response.headers["Vary"] = "Cookie, Authorization"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        return response

    @app.errorhandler(MelaError)
    def _mela_error(error):
        return _error_response(error)

    @app.errorhandler(db.DatabaseUnavailable)
    def _unavailable(_error):
        return _error_response(
            MelaError(503, "service_unavailable", headers={"Retry-After": "5"})
        )

    @app.errorhandler(HTTPException)
    def _http_error(error):
        if _wants_json() and error.code in (404, 405):
            return _error_response(MelaError(404, "not_found"))
        code = "not_found" if error.code == 404 else "request_refused"
        return _error_response(MelaError(error.code, code))

    return app


def _cover_id(name: str, theme: str) -> str:
    return hashlib.sha1(f"{theme}:{name}".encode()).hexdigest()[:10]
