"""Request and response objects and the one answer envelope."""
import json
import time
import uuid
from http.cookies import SimpleCookie
from urllib.parse import parse_qsl

from . import config
from .errors import TesselError

HTML_SECURITY_HEADERS = (
    ("X-Content-Type-Options", "nosniff"),
    ("Referrer-Policy", "strict-origin-when-cross-origin"),
    ("X-Frame-Options", "DENY"),
)


class BodyTooLarge(Exception):
    pass


class Request:
    def __init__(self, environ):
        self.environ = environ
        self.method = environ.get("REQUEST_METHOD", "GET").upper()
        self.path = environ.get("PATH_INFO") or "/"
        self.query_string = environ.get("QUERY_STRING") or ""
        self._query = None
        self._body = None
        self._form = None
        self._cookies = None
        self.started = time.monotonic()
        self.request_id = str(uuid.uuid4())

    def header(self, name):
        key = "HTTP_" + name.upper().replace("-", "_")
        if name.lower() == "content-type":
            key = "CONTENT_TYPE"
        elif name.lower() == "content-length":
            key = "CONTENT_LENGTH"
        return self.environ.get(key)

    @property
    def query(self):
        if self._query is None:
            self._query = parse_qsl(self.query_string, keep_blank_values=True)
        return self._query

    def param(self, name, default=None):
        for key, value in self.query:
            if key == name:
                return value
        return default

    def has_param(self, name):
        return any(key == name for key, _ in self.query)

    def params(self, name):
        return [value for key, value in self.query if key == name]

    @property
    def cookies(self):
        if self._cookies is None:
            jar = SimpleCookie()
            raw = self.environ.get("HTTP_COOKIE")
            if raw:
                jar.load(raw)
            self._cookies = {key: morsel.value for key, morsel in jar.items()}
        return self._cookies

    def raw_body(self):
        """Read the body once, refusing anything over the size limit."""
        if self._body is None:
            declared = self.environ.get("CONTENT_LENGTH") or ""
            chunked = self.environ.get("HTTP_TRANSFER_ENCODING")
            if declared.isdigit() and int(declared) > config.MAX_BODY_BYTES:
                raise BodyTooLarge()
            stream = self.environ.get("wsgi.input")
            if stream is None or not (declared.isdigit() or chunked):
                self._body = b""
                return self._body
            data = stream.read(config.MAX_BODY_BYTES + 1)
            if len(data) > config.MAX_BODY_BYTES:
                raise BodyTooLarge()
            self._body = data
        return self._body

    def form_pairs(self):
        if self._form is None:
            raw = self.raw_body()
            self._form = parse_qsl(
                raw.decode("utf-8", "replace"), keep_blank_values=True
            )
        return self._form

    def form(self):
        """Parse a urlencoded form body into a single-value mapping."""
        out = {}
        for key, value in self.form_pairs():
            out.setdefault(key, value)
        return out

    def form_list(self, name):
        return [value for key, value in self.form_pairs() if key == name]

    def wants_markdown(self):
        if self.has_param("md"):
            return True
        accept = self.header("Accept") or ""
        return "text/markdown" in accept.lower()

    def latency_ms(self):
        return int((time.monotonic() - self.started) * 1000)


class Response:
    def __init__(self, status=200, body=b"", headers=None, content_type=None):
        self.status = status
        self.body = body if isinstance(body, bytes) else str(body).encode("utf-8")
        self.headers = list(headers or [])
        if content_type:
            self.headers.append(("Content-Type", content_type))

    def add(self, name, value):
        self.headers.append((name, value))
        return self

    def set_cookie(self, name, value, max_age=None, http_only=True):
        parts = ["%s=%s" % (name, value), "Path=/", "SameSite=Lax"]
        if http_only:
            parts.append("HttpOnly")
        if max_age is not None:
            parts.append("Max-Age=%d" % max_age)
        self.headers.append(("Set-Cookie", "; ".join(parts)))
        return self

    def clear_cookie(self, name):
        self.headers.append(
            ("Set-Cookie", "%s=; Path=/; SameSite=Lax; HttpOnly; Max-Age=0" % name)
        )
        return self


STATUS_TEXT = {
    200: "200 OK",
    201: "201 Created",
    202: "202 Accepted",
    303: "303 See Other",
    304: "304 Not Modified",
    400: "400 Bad Request",
    401: "401 Unauthorized",
    403: "403 Forbidden",
    404: "404 Not Found",
    405: "405 Method Not Allowed",
    409: "409 Conflict",
    413: "413 Payload Too Large",
    422: "422 Unprocessable Entity",
    429: "429 Too Many Requests",
    503: "503 Service Unavailable",
}


def _dump(payload):
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def meta_for(request):
    return {"request_id": request.request_id, "latency_ms": request.latency_ms()}


def api_success(request, data, status=200, headers=None):
    payload = {"success": True, "data": data, "error": None, "meta": meta_for(request)}
    return Response(
        status,
        _dump(payload),
        headers=headers,
        content_type="application/json; charset=utf-8",
    )


def api_refusal(request, error):
    payload = {
        "success": False,
        "data": None,
        "error": {"code": error.code, "message": error.message, "field": error.field},
        "meta": meta_for(request),
    }
    response = Response(
        error.status,
        _dump(payload),
        content_type="application/json; charset=utf-8",
    )
    for name, value in error.headers.items():
        response.add(name, value)
    return response


def html(body, status=200, headers=None):
    response = Response(status, body, headers=headers, content_type="text/html; charset=utf-8")
    for name, value in HTML_SECURITY_HEADERS:
        response.add(name, value)
    return response


def redirect(location, status=303):
    response = Response(status, b"", headers=[("Location", location)])
    for name, value in HTML_SECURITY_HEADERS:
        response.add(name, value)
    return response


def method_not_allowed(request, allowed):
    error = TesselError(
        "METHOD_NOT_ALLOWED",
        method=request.method,
        headers={"Allow": ", ".join(sorted(allowed))},
    )
    if request.method == "HEAD":
        response = Response(405, b"")
        response.add("Allow", ", ".join(sorted(allowed)))
        response.add("Content-Type", "application/json; charset=utf-8")
        return response
    return api_refusal(request, error)
