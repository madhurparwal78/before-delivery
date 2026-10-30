"""The server boundary: refusal-order checks 1 to 5 for every request, the error shape, and the response
headers. Later checks belong to rules.decide."""

import json
from collections.abc import Callable

from flask import Flask, Response, g, request
from werkzeug.exceptions import MethodNotAllowed, NotFound

from . import auth
from .db import transaction
from .errors import NOT_FOUND, Refusal

BODY_LIMIT = 65536
PACK_LIMIT = 1_000_000
WRITES = {"POST", "PUT", "PATCH", "DELETE"}
OPEN_API = {("GET", "/api/health"), ("POST", "/api/auth/login")}
DEFAULT_PORTS = {"http": "80", "https": "443"}


def json_response(data: object, status: int = 200) -> Response:
    return Response(json.dumps(data, ensure_ascii=False), status=status,
                    content_type="application/json; charset=utf-8")


def session_token() -> str | None:
    header = request.headers.get("Authorization", "")
    if header.startswith("Bearer "):
        return header[7:].strip() or None
    return request.cookies.get(auth.COOKIE)


def _host_port(value: str, scheme: str) -> str:
    host, sep, port = value.lower().rpartition(":")
    if not sep or not port.isdigit():
        host, port = value.lower(), DEFAULT_PORTS.get(scheme, "80")
    return f"{host}:{port}"


def check_request() -> None:
    limit = PACK_LIMIT if (request.method, request.path) == ("POST", "/api/pack") else BODY_LIMIT
    if (request.content_length or 0) > limit:
        raise Refusal(413, "That request is too large")
    request.max_content_length = limit
    if isinstance(request.routing_exception, MethodNotAllowed):
        raise Refusal(405, "That cannot be done here")
    if isinstance(request.routing_exception, NotFound):
        raise Refusal(404, NOT_FOUND)
    if request.method in WRITES:
        origin = request.headers.get("Origin")
        if origin:
            scheme, _, rest = origin.partition("://")
            if not rest or _host_port(rest, scheme) != _host_port(request.host, scheme):
                raise Refusal(403, "Cross-site requests are refused")
        if (request.content_length or request.headers.get("Transfer-Encoding")) and \
                request.mimetype != "application/json":
            raise Refusal(415, "Send JSON")
    g.account = None
    if request.path.startswith("/api/") and (request.method, request.path) not in OPEN_API:
        with transaction() as tx:
            g.account = auth.account_for_token(tx, session_token())
        if g.account is None:
            raise Refusal(401, "Sign in first")


def body() -> object:
    """The JSON body; anything that does not parse is treated as "not a JSON object"."""
    raw = request.get_data(cache=True)
    try:
        return json.loads(raw) if raw.strip() else None
    except (ValueError, UnicodeDecodeError):
        return None




def headers(response: Response) -> Response:
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    return response


def install(app: Flask, not_found_page: Callable[[], Response]) -> None:
    def refusal_response(error: Refusal) -> Response:
        if error.status == 404 and not request.path.startswith("/api/"):
            return not_found_page()
        return json_response(error.body(), error.status)

    app.before_request(check_request)
    app.after_request(headers)
    app.register_error_handler(Refusal, refusal_response)
