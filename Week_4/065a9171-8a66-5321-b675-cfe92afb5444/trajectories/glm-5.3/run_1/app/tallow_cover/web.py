"""The HTTP boundary: origin checks, size limits, sessions, routing and static files.

Only the built browser assets and /api are served. Errors use the one shape.
"""
import json
import mimetypes
import os
import re
import socketserver
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import domain
from .errors import ApiError
from . import repo

JSON_LIMIT = 65536
MULTIPART_LIMIT = 5100000
SESSION_COOKIE = "tallow_session"
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
SPA_ROUTES = re.compile(
    r"^/(sign-in|shifts|leave|leave/new|sickness|rota|cover|accrual|queue|today|floors|"
    r"attendance|pay-periods|exports|audit|profile)(/[A-Za-z0-9_\-]*)?$")

DANGEROUS_PATH = re.compile(r"(^|/)(\.|run\.json)|\.py$|requirements\.txt|THIRD_PARTY")


class Request:
    def __init__(self, method, path, query, headers, body, person=None):
        self.method = method
        self.path = path
        self.query = query
        self.headers = headers
        self.body = body
        self.person = person


class Response:
    def __init__(self, status=200, body=None, headers=None, raw=None):
        self.status = status
        self.body = body
        self.headers = headers or {}
        self.raw = raw


class HttpApp:
    """Holds the store and services; api.py registers route handlers."""

    def __init__(self, store, config, mailer, storage, keyed):
        self.store = store
        self.config = config
        self.mailer = mailer
        self.storage = storage
        self.keyed = keyed
        self.routes = []

    def route(self, method, pattern, roles=None):
        """Register a handler. `pattern` is a regex over the path; named groups
        become arguments. roles=None means no session is needed."""
        compiled = re.compile(pattern)
        def wrap(fn):
            self.routes.append((method, compiled, roles, fn))
            return fn
        return wrap

    def dispatch(self, request):
        matched_path = False
        for method, pattern, roles, fn in self.routes:
            m = pattern.match(request.path)
            if not m:
                continue
            matched_path = True
            if method != request.method:
                continue
            if roles is not None and request.person is None:
                raise ApiError("not_signed_in")
            if roles is not None and request.person["role"] not in roles:
                raise ApiError("forbidden")
            return fn(request, **m.groupdict())
        if matched_path:
            raise ApiError("method_not_allowed")
        raise ApiError("not_found")


def _session_from_headers(app, headers):
    cookie = headers.get("Cookie", "")
    for part in cookie.split(";"):
        name, _, value = part.strip().partition("=")
        if name == SESSION_COOKIE and value:
            conn = app.store.connect()
            try:
                rows = conn.execute(
                    "select person_id from sessions where token = $1 and expires_at > now()",
                    [value])
                if rows:
                    person = repo.get_person(conn, rows[0][0].decode())
                    if person:
                        return person, value
            finally:
                app.store.release(conn)
    return None, None


def _load_request(handler):
    """Read and pre-check a request body. Raises ApiError for transport issues."""
    length_header = handler.headers.get("Content-Length")
    try:
        length = int(length_header) if length_header else 0
    except ValueError:
        length = 0
    content_type = (handler.headers.get("Content-Type") or "").split(";")[0].strip().lower()
    limit = MULTIPART_LIMIT if content_type == "multipart/form-data" else JSON_LIMIT
    if length > limit:
        raise ApiError("too_large")
    body = handler.rfile.read(length) if length else b""
    origin = handler.headers.get("Origin")
    own_origin = f"http://{handler.headers.get('Host', '')}"
    if handler.command in ("POST", "PATCH", "PUT", "DELETE") and origin and origin != own_origin:
        raise ApiError("cross_origin")
    if length and content_type not in ("application/json", "multipart/form-data"):
        raise ApiError("unsupported_media_type")
    return content_type, body


def _parse_multipart(body, boundary):
    """Return {field: (filename, bytes)} for a multipart body."""
    fields = {}
    delim = b"--" + boundary
    parts = body.split(delim)
    for part in parts[1:-1] if len(parts) > 2 else parts[1:]:
        chunk = part
        if chunk.endswith(b"\r\n"):
            chunk = chunk[:-2]
        header_blob, _, content = chunk.partition(b"\r\n\r\n")
        if not _:
            continue
        name = None
        filename = None
        for line in header_blob.split(b"\r\n"):
            if line.lower().startswith(b"content-disposition:"):
                for piece in line.split(b";"):
                    piece = piece.strip()
                    if piece.startswith(b"name="):
                        name = piece[5:].strip(b'"').decode()
                    elif piece.startswith(b"filename="):
                        filename = piece[9:].strip(b'"').decode()
        if name:
            fields[name] = (filename, content)
    return fields


class Handler(BaseHTTPRequestHandler):
    server_version = "TallowCover/1.0"
    app = None
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        pass

    def _dispatch(self):
        app = self.app
        parsed = urllib.parse.urlsplit(self.path)
        path = urllib.parse.unquote(parsed.path)
        query = {k: v[0] for k, v in urllib.parse.parse_qs(parsed.query).items()}
        try:
            if path.startswith("/api"):
                content_type, body = _load_request(self)
                person, token = _session_from_headers(app, self.headers)
                request = Request(self.command, path, query, self.headers, body, person)
                request.content_type = content_type
                response = app.dispatch(request)
            else:
                response = self._serve_static(path)
        except ApiError as err:
            response = Response(err.status, err.body())
        except Exception:
            import traceback
            traceback.print_exc()
            err = ApiError("not_found")
            response = Response(err.status, err.body())
        self._send(response)

    def _serve_static(self, path):
        if DANGEROUS_PATH.search(path) or ".." in path:
            raise ApiError("not_found")
        if path == "/" or SPA_ROUTES.match(path):
            return self._file("index.html")
        if path.startswith("/assets/"):
            return self._file(path[len("/assets/"):])
        raise ApiError("not_found")

    def _file(self, name):
        full = os.path.normpath(os.path.join(STATIC_DIR, name))
        if not full.startswith(STATIC_DIR) or not os.path.isfile(full):
            raise ApiError("not_found")
        with open(full, "rb") as fh:
            data = fh.read()
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        return Response(200, raw=data, headers={"Content-Type": ctype,
                                                "Cache-Control": "no-cache"})

    def _send(self, response):
        if response.raw is not None:
            payload = response.raw
        else:
            payload = json.dumps(response.body).encode()
        self.send_response(response.status)
        base_headers = {"Content-Type": "application/json; charset=utf-8",
                        "Content-Length": str(len(payload)),
                        "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}
        if response.body is not None and isinstance(response.body, dict) and \
                response.body.get("error") in ("cross_origin",):
            base_headers["Vary"] = "Origin"
        for k, v in {**base_headers, **response.headers}.items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(payload)

    def do_GET(self):
        self._dispatch()

    def do_POST(self):
        self._dispatch()

    def do_PATCH(self):
        self._dispatch()

    def do_PUT(self):
        self._dispatch()

    def do_DELETE(self):
        self._dispatch()

    def do_HEAD(self):
        self._dispatch()


def serve(app, host, port):
    handler = type("BoundHandler", (Handler,), {"app": app})
    httpd = ThreadingHTTPServer((host, port), handler)
    httpd.daemon_threads = True
    return httpd
