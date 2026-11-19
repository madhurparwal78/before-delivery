"""The Flask application: the published surface and nothing else."""

from __future__ import annotations

from pathlib import Path

from flask import Flask, Response, request, send_from_directory

from . import db, store
from .api import MAX_BODY_BYTES, error_response
from .api.auth import auth
from .api.desk import desk
from .api.oversight import oversight
from .api.review import review
from .errors import ApiError, body_too_large, not_found, store_unavailable
from .services import objectstore
from .services.http import ProviderUnavailable

STATIC = Path(__file__).parent / "static"

APP_ROUTES = (
    "/",
    "/sign-in",
    "/windows",
    "/review",
    "/group",
    "/check",
)


def create_app() -> Flask:
    app = Flask(__name__, static_folder=str(STATIC), static_url_path="/static")

    for blueprint in (auth, desk, review, oversight):
        app.register_blueprint(blueprint, url_prefix="/api")

    @app.before_request
    def guard_body_size():
        length = request.content_length
        if length is not None and length > MAX_BODY_BYTES:
            return error_response(body_too_large())
        return None

    @app.errorhandler(ApiError)
    def handle_api_error(failure: ApiError):
        return error_response(failure)

    @app.errorhandler(404)
    def handle_missing(_failure):
        if _wants_json():
            return error_response(not_found())
        return _shell()

    @app.errorhandler(405)
    def handle_method(_failure):
        return error_response(not_found())

    @app.get("/check/<code>/attestation.pdf")
    def public_attestation(code: str):
        with db.tx() as cursor:
            record = store.signature_by_code(cursor, code)
            if record is None or record["sealed_at"] is None:
                raise not_found()
            object_key = record["pdf_object_key"]
        try:
            data = objectstore.get(object_key)
        except ProviderUnavailable:
            raise store_unavailable() from None
        return Response(data, content_type="application/pdf")

    @app.get("/")
    @app.get("/<path:unused>")
    def app_shell(unused: str = ""):
        if _wants_json():
            raise not_found()
        return _shell()

    return app


def _wants_json() -> bool:
    return request.path.startswith("/api/")


def _shell() -> Response:
    response = send_from_directory(STATIC, "index.html")
    response.headers["Cache-Control"] = "no-store"
    return response
