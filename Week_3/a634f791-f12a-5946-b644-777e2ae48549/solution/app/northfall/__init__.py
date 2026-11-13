"""Northfall Reference Desk: the public reference library and the private desk, on one origin."""
import logging
from pathlib import Path

import psycopg
from flask import Flask, request
from markupsafe import Markup
from werkzeug.exceptions import HTTPException, MethodNotAllowed

from . import pages as page_routes
from .api import Refusal, api, drain_body, guard_api_request, is_api_path, reads, send
from .store import release_db, start_preparing

log = logging.getLogger(__name__)

# Page requests that answer without the store: the assets, and the desk page, which keeps answering in an outage.
STORELESS_ENDPOINTS = ("static", "desk.desk_page")


def create_app():
    app = Flask(__name__)
    app.config["PROVIDE_AUTOMATIC_OPTIONS"] = False
    app.url_map.strict_slashes = True
    app.url_map.merge_slashes = False
    # The stylesheet travels inside each page, so no page is ever laid out before its styles apply.
    app.jinja_env.globals["stylesheet"] = Markup((Path(app.static_folder) / "site.css").read_text())

    app.register_blueprint(api, url_prefix="/api")
    app.register_blueprint(reads, url_prefix="/api")
    app.register_blueprint(reads, url_prefix="/api/fi", name="reads_fi")
    app.register_blueprint(page_routes.pages)
    app.register_blueprint(page_routes.pages, url_prefix="/fi", name="pages_fi")
    app.register_blueprint(page_routes.desk)

    app.before_request(guard_api_request)
    app.before_request(settle_before_page)
    app.after_request(harden)
    app.teardown_appcontext(release_db)

    app.register_error_handler(Refusal, Refusal.response)
    app.register_error_handler(HTTPException, http_refusal)
    app.register_error_handler(psycopg.OperationalError, store_unreachable)
    app.register_error_handler(Exception, unexpected)

    start_preparing()
    return app


def settle_before_page():
    if not is_api_path(request.path) and request.routing_exception is None and request.endpoint not in STORELESS_ENDPOINTS:
        page_routes.settle_for_page()


def harden(response):
    drain_body()
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    response.headers.setdefault("X-Frame-Options", "DENY")
    return response


def http_refusal(error):
    allow = ", ".join(sorted(error.valid_methods)) if isinstance(error, MethodNotAllowed) else None
    if is_api_path(request.path):
        return Refusal(405 if allow else 404, headers={"Allow": allow} if allow else None).response()
    return page_routes.not_allowed_page() if allow else page_routes.not_found_page()


def store_unreachable(_error):
    if request.endpoint == "api.health":
        return send({"status": "starting"}, 503)
    if is_api_path(request.path):
        return Refusal(503).response()
    return page_routes.outage_page()


def unexpected(error):
    log.exception("unexpected error", exc_info=error)
    if is_api_path(request.path):
        return Refusal(500).response()
    return page_routes.outage_page()[0], 500
