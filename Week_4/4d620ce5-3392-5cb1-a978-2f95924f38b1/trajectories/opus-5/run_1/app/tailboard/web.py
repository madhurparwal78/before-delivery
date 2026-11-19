"""The HTTP surface: request parsing, responses, static files and the threaded server."""

import json
import mimetypes
import pathlib
import sys
import threading
import traceback
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .config import SESSION_COOKIE, config
from .errors import ApiError

STATIC_ROOT = pathlib.Path(__file__).resolve().parent.parent / "static"
JSON_TYPE = "application/json; charset=utf-8"
DRAIN_LIMIT = 25_000_000


class Request:
    def __init__(self, method, path, query, headers, body, client_origin_ok):
        self.method = method
        self.path = path
        self.query = query
        self.headers = headers
        self.body = body
        self.client_origin_ok = client_origin_ok
        self.params = {}
        self.user = None
        self.session_id = None

    @property
    def content_type(self):
        return (self.headers.get("content-type") or "").split(";")[0].strip().lower()

    def json(self):
        if not self.body:
            return {}
        try:
            parsed = json.loads(self.body.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            raise ApiError("validation", "The request body is not valid JSON.", fields={})
        if not isinstance(parsed, dict):
            raise ApiError("validation", "The request body must be a JSON object.", fields={})
        return parsed

    def q(self, name, default=None):
        values = self.query.get(name)
        return values[0] if values else default

    def cookie(self, name):
        raw = self.headers.get("cookie") or ""
        for part in raw.split(";"):
            key, _, value = part.strip().partition("=")
            if key == name:
                return value
        return None


class Response:
    def __init__(self, status=200, body=b"", content_type=JSON_TYPE, headers=None):
        self.status = status
        self.body = body
        self.content_type = content_type
        self.headers = headers or []


def json_response(payload, status=200, headers=None):
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    return Response(status, body, JSON_TYPE, headers)


def error_response(error):
    return json_response(error.body(), error.status)


class StreamResponse:
    """A server-sent event stream."""

    def __init__(self, generator):
        self.generator = generator
        self.status = 200
        self.headers = [
            ("Content-Type", "text/event-stream; charset=utf-8"),
            ("Cache-Control", "no-store"),
            ("X-Accel-Buffering", "no"),
            ("Connection", "close"),
        ]


def set_session_cookie(response, value):
    response.headers.append(
        ("Set-Cookie", f"{SESSION_COOKIE}={value}; HttpOnly; SameSite=Strict; Path=/")
    )
    # a flag the board reads to know whether to ask for the session at all
    response.headers.append(("Set-Cookie", "tb_signed_in=1; SameSite=Strict; Path=/"))


def clear_session_cookie(response):
    response.headers.append(
        ("Set-Cookie", f"{SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0")
    )
    response.headers.append(("Set-Cookie", "tb_signed_in=; SameSite=Strict; Path=/; Max-Age=0"))


SAFE_SUFFIXES = {".html", ".js", ".css", ".woff2", ".svg", ".png", ".ico", ".txt", ".map"}


def static_response(path):
    """Serve the app's own pages, scripts, fonts and icons. Nothing else is served."""
    relative = path.lstrip("/")
    candidate = (STATIC_ROOT / relative).resolve()
    if (
        relative
        and STATIC_ROOT in candidate.parents
        and candidate.is_file()
        and candidate.suffix in SAFE_SUFFIXES
    ):
        content_type = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
        if candidate.suffix == ".woff2":
            content_type = "font/woff2"
        cache = "public, max-age=86400" if candidate.suffix == ".woff2" else "no-cache"
        return Response(
            200,
            candidate.read_bytes(),
            f"{content_type}; charset=utf-8" if content_type.startswith("text/") else content_type,
            [("Cache-Control", cache)],
        )
    shell = (STATIC_ROOT / "index.html").read_bytes()
    return Response(200, shell, "text/html; charset=utf-8", [("Cache-Control", "no-cache")])


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "Tailboard"
    sys_version = ""
    dispatch = None

    def log_message(self, *_args):
        pass

    def _origin_ok(self):
        origin = self.headers.get("Origin")
        if not origin:
            return True
        host = self.headers.get("Host") or ""
        allowed = {config.public_url.rstrip("/")}
        if host:
            allowed |= {f"http://{host}", f"https://{host}"}
        return origin.rstrip("/") in allowed

    def _handle(self, method):
        parsed = urllib.parse.urlsplit(self.path)
        path = urllib.parse.unquote(parsed.path)
        query = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
        headers = {key.lower(): value for key, value in self.headers.items()}
        try:
            declared = int(headers.get("content-length") or 0)
        except ValueError:
            declared = 0
        request = Request(method, path, query, headers, b"", self._origin_ok())
        self._consumed = 0
        self._declared = declared
        try:
            response = Handler.dispatch(request, self._read_body, declared)
        except ApiError as error:
            response = error_response(error)
        except Exception:  # an unexpected fault must not take the server down
            traceback.print_exc(file=sys.stderr)
            response = json_response(
                {"error": {"code": "internal", "message": "The server could not complete that."}},
                500,
            )
        if isinstance(response, StreamResponse):
            self._send_stream(response)
        else:
            self._drain()
            self._send(response)

    def _read_body(self, limit):
        if self._declared <= 0:
            return b""
        data = self.rfile.read(min(self._declared, limit + 1))
        self._consumed += len(data)
        return data

    def _drain(self):
        """Read the rest of a rejected body so the client can read the answer."""
        remaining = self._declared - self._consumed
        if remaining <= 0:
            return
        if remaining > DRAIN_LIMIT:
            self.close_connection = True
            return
        while remaining > 0:
            chunk = self.rfile.read(min(remaining, 65536))
            if not chunk:
                break
            remaining -= len(chunk)

    def _send(self, response):
        body = response.body or b""
        self.send_response(response.status)
        if response.status != 204:
            self.send_header("Content-Type", response.content_type)
            self.send_header("Content-Length", str(len(body)))
        for name, value in response.headers:
            self.send_header(name, value)
        if self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.end_headers()
        if body and self.command != "HEAD":
            self.wfile.write(body)

    def _send_stream(self, response):
        self.close_connection = True
        self.send_response(response.status)
        for name, value in response.headers:
            self.send_header(name, value)
        self.end_headers()
        try:
            for chunk in response.generator:
                self.wfile.write(chunk)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass

    def do_GET(self):
        self._handle("GET")

    def do_HEAD(self):
        self._handle("HEAD")

    def do_POST(self):
        self._handle("POST")

    def do_PUT(self):
        self._handle("PUT")

    def do_PATCH(self):
        self._handle("PATCH")

    def do_DELETE(self):
        self._handle("DELETE")

    def do_OPTIONS(self):
        self._handle("OPTIONS")


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    request_queue_size = 64


def serve_forever(dispatch, port):
    Handler.dispatch = staticmethod(dispatch)
    httpd = Server(("0.0.0.0", port), Handler)
    thread = threading.Thread(target=httpd.serve_forever, name="http", daemon=False)
    thread.start()
    return httpd
