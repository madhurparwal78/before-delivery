"""Mela: a free public event platform for small community hosts."""
from urllib.parse import urlsplit

from flask import Flask, abort, g, request

from . import accounts, art, config, db, errors, events, fmt
from .errors import ApiError

NO_STORE = {"Cache-Control": "private, no-store", "Vary": "Cookie, Authorization"}


def create_app():
    """Build the app without touching the database; the first request that reaches PostgreSQL sets it up."""
    app = Flask(__name__)
    app.config.update(MAX_CONTENT_LENGTH=config.BODY_LIMIT, SEND_FILE_MAX_AGE_DEFAULT=3600)
    app.json.mimetype = "application/json; charset=utf-8"
    app.json.sort_keys = False

    from .api import api
    from .pages import pages
    app.register_blueprint(api)
    app.register_blueprint(pages)
    errors.install(app)
    app.teardown_request(db.close)

    @app.before_request
    def prepare():
        g.member = None
        if request.endpoint in ("static", "api.health"):
            return
        if "\x00" in request.path:
            abort(404)
        db.conn()
        request.get_data(cache=True)
        if request.method not in ("GET", "HEAD", "OPTIONS") and _cross_origin():
            raise ApiError(403, "cross_origin")
        accounts.load_member()

    @app.after_request
    def headers(response):
        if request.endpoint != "static":
            response.headers.update(NO_STORE)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "same-origin")
        response.headers.setdefault("X-Frame-Options", "DENY")
        return response

    @app.context_processor
    def helpers():
        return {"me": g.get("member"), "fmt": fmt, "art": art, "iso": events.iso}

    return app


def _cross_origin():
    """A state change sent by another site: an Origin from elsewhere, or a browser that says cross-site."""
    origin = request.headers.get("Origin")
    if origin and urlsplit(origin).netloc != request.host:
        return True
    return request.headers.get("Sec-Fetch-Site") == "cross-site"
