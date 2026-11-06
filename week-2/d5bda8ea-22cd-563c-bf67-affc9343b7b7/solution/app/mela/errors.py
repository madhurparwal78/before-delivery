"""The one path every /api error leaves the server by, and the outage and not-found pages."""
import psycopg
from flask import jsonify, render_template, request
from werkzeug.exceptions import HTTPException


class ApiError(Exception):
    """An /api refusal: `{"error": code, **extra}`, or `{"errors": fields}` for validation."""

    def __init__(self, http_status, code=None, fields=None, headers=None, **extra):
        super().__init__(code or "invalid")
        self.http_status, self.code, self.fields, self.headers, self.extra = http_status, code, fields, headers or {}, extra

    def body(self):
        return {"errors": self.fields} if self.fields is not None else {"error": self.code, **self.extra}


def invalid(fields):
    return ApiError(422, fields=fields)


def not_found():
    return ApiError(404, "not_found")


def _api_response(error):
    response = jsonify(error.body())
    response.status_code = error.http_status
    response.headers.update(error.headers)
    return response


def _is_api():
    return request.path == "/api" or request.path.startswith("/api/")


def outage_page():
    return render_template("outage.html", visitor_view=True), 503


def install(app):
    @app.errorhandler(ApiError)
    def api_error(error):
        return _api_response(error)

    @app.errorhandler(psycopg.OperationalError)
    @app.errorhandler(psycopg.InterfaceError)
    def unavailable(_error):
        if _is_api():
            return _api_response(ApiError(503, "service_unavailable", headers={"Retry-After": "5"}))
        return outage_page()

    @app.errorhandler(HTTPException)
    def http_error(error):
        if _is_api():
            code = {404: "not_found", 405: "method_not_allowed", 413: "payload_too_large"}.get(error.code, "bad_request")
            return _api_response(ApiError(error.code, code))
        if error.code == 404:
            return render_template("notfound.html"), 404
        return error

    @app.errorhandler(Exception)
    def unexpected(error):
        app.logger.exception("unhandled error")
        if _is_api():
            return _api_response(ApiError(500, "internal_error"))
        return render_template("notfound.html"), 500
