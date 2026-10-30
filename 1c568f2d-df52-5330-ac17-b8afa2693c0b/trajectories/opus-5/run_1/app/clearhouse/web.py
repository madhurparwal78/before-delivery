"""The WSGI application: the request gate, the error shape and the boot threads."""
import os
import threading
from urllib.parse import urlsplit

from flask import Flask, g, render_template, request
from werkzeug.exceptions import HTTPException, MethodNotAllowed

from . import api, auth, config, db, errors, identity, views
from .errors import Refusal

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE_METHODS = ("POST", "PUT", "PATCH", "DELETE")
PACK_LIMIT = 1000000
BODY_LIMIT = 65536
OPEN_ROUTES = (("GET", "/api/health"), ("POST", "/api/auth/login"))


def _origin_authority(origin):
    split = urlsplit(origin)
    return split.netloc


def create_app():
    app = Flask(
        __name__,
        template_folder=os.path.join(BASE, "templates"),
        static_folder=os.path.join(BASE, "static"),
        static_url_path="/static",
    )
    app.config["MAX_CONTENT_LENGTH"] = PACK_LIMIT + BODY_LIMIT
    app.register_blueprint(api.bp)
    app.register_blueprint(views.bp)

    @app.before_request
    def gate():
        data = request.get_data(cache=True)
        limit = (
            PACK_LIMIT
            if request.method == "POST" and request.path == "/api/pack"
            else BODY_LIMIT
        )
        if len(data) > limit:
            raise Refusal(413, errors.TOO_LARGE)
        routing = request.routing_exception
        if routing is not None:
            if isinstance(routing, MethodNotAllowed):
                raise Refusal(405, errors.NO_METHOD)
            raise Refusal(404, errors.NOT_FOUND)
        if request.method in WRITE_METHODS:
            origin = request.headers.get("Origin")
            if origin and _origin_authority(origin) != request.host:
                raise Refusal(403, errors.CROSS_SITE)
            if data and request.mimetype != "application/json":
                raise Refusal(415, errors.SEND_JSON)
        header = request.headers.get("Authorization", "")
        g.token = (
            header[7:].strip()
            if header.lower().startswith("bearer ")
            else request.cookies.get(config.SESSION_COOKIE)
        )
        g.account = None
        if g.token and db.ready():
            with db.tx() as conn:
                g.account = auth.account_for_token(conn, g.token)
        if (
            request.path.startswith("/api")
            and (request.method, request.path) not in OPEN_ROUTES
            and g.account is None
        ):
            raise Refusal(401, errors.SIGN_IN_FIRST)

    @app.context_processor
    def surface():
        return {
            "account": getattr(g, "account", None),
            "prefs": views.settings_for_request(),
            "path": request.path,
            "role_label": views.ROLE_LABELS,
        }

    @app.errorhandler(Refusal)
    def refused(refusal):
        if request.path.startswith("/api"):
            return api.send(refusal.body(), refusal.status)
        if refusal.status == 404:
            return render_template("not_found.html"), 404
        return (
            render_template("refusal.html", message=refusal.message),
            refusal.status,
        )

    @app.errorhandler(HTTPException)
    def http_error(error):
        status = error.code or 500
        message = {
            404: errors.NOT_FOUND,
            405: errors.NO_METHOD,
            413: errors.TOO_LARGE,
            415: errors.SEND_JSON,
        }.get(status, "That could not be done")
        return refused(Refusal(status, message))

    @app.errorhandler(Exception)
    def failed(error):
        app.logger.exception(error)
        return refused(Refusal(500, "The desk could not complete that"))

    @app.after_request
    def quiet(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        return response

    threading.Thread(target=db.boot_forever, name="boot", daemon=True).start()
    identity.start_monitor()
    return app
