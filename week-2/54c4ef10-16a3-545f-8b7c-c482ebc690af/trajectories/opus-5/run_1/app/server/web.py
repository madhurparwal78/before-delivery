"""The HTTP server: same-origin pages, static files and the JSON API."""

from __future__ import annotations

import json
import mimetypes
import re
import threading
import urllib.parse
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable

from . import db, errors, pages
from .config import CONFIG, JSON_BODY_LIMIT

STATIC_ROOT = Path(__file__).resolve().parent.parent / "static"
STATE_CHANGING = ("POST", "PUT", "PATCH", "DELETE")
SESSION_COOKIE = "edgeprint_session"
READ_CHUNK = 262_144
DRAIN_LIMIT = 1_048_576


class ClientDisconnected(Exception):
    """The client dropped the connection mid-body."""


@dataclass
class Response:
    status: int = 200
    body: bytes = b""
    content_type: str = "application/json"
    headers: list[tuple[str, str]] = field(default_factory=list)
    close: bool = False


def json_response(
    status: int, payload: Any, headers: list[tuple[str, str]] | None = None
) -> Response:
    return Response(
        status=status,
        body=json.dumps(payload).encode(),
        content_type="application/json",
        headers=headers or [],
    )


@dataclass
class Request:
    method: str
    path: str
    query: dict[str, str]
    headers: Any
    rfile: Any
    account: dict[str, Any] | None = None
    session_token: str | None = None
    consumed: int = 0

    def header(self, name: str) -> str | None:
        return self.headers.get(name)

    def content_length(self) -> int:
        raw = self.headers.get("Content-Length")
        if raw is None or not raw.isdigit():
            return 0
        return int(raw)

    def json_body(self) -> dict[str, Any]:
        length = self.content_length()
        if length > JSON_BODY_LIMIT:
            raise errors.too_large()
        content_type = (self.headers.get("Content-Type") or "").split(";")[0].strip()
        if content_type != "application/json":
            raise errors.unsupported_media_type()
        raw = self.read_exactly(length)
        if not raw:
            return {}
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise errors.validation_failed({}) from exc
        return parsed if isinstance(parsed, dict) else {}

    def read_exactly(self, length: int) -> bytes:
        chunks: list[bytes] = []
        remaining = length
        while remaining > 0:
            chunk = self.rfile.read(min(READ_CHUNK, remaining))
            if not chunk:
                raise ClientDisconnected
            chunks.append(chunk)
            remaining -= len(chunk)
            self.consumed += len(chunk)
        return b"".join(chunks)

    def unread_body(self) -> int:
        return max(0, self.content_length() - self.consumed)


Route = tuple[re.Pattern[str], str, Callable[..., Response]]


def session_account(token: str | None) -> dict[str, Any] | None:
    if not token:
        return None
    return db.fetch_one(
        """
        SELECT a.id, a.email
        FROM sessions s
        JOIN accounts a ON a.id = s.account_id
        WHERE s.token = %s AND s.expires_at > now()
        """,
        (token,),
    )


def _cookie_value(cookie_header: str | None, name: str) -> str | None:
    if not cookie_header:
        return None
    for part in cookie_header.split(";"):
        key, _, value = part.strip().partition("=")
        if key == name:
            return value
    return None


def same_origin(request: Request, host: str | None) -> bool:
    origin = request.header("Origin")
    if not origin:
        return True
    allowed = set()
    if host:
        allowed.add(f"http://{host}")
        allowed.add(f"https://{host}")
    if CONFIG.public_url:
        allowed.add(CONFIG.public_url.rstrip("/"))
    return origin.rstrip("/") in allowed


def is_safe_next(value: str) -> bool:
    """`next` is safe only in both its query-decoded and once-more-decoded forms."""
    once = value
    twice = urllib.parse.unquote(value)
    for candidate in (once, twice):
        if not candidate.startswith("/"):
            return False
        if candidate.startswith("//") or candidate.startswith("/\\"):
            return False
        if any(ord(character) <= 31 or ord(character) == 127 for character in candidate):
            return False
    return True


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "edgeprint"
    sys_version = ""

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        return

    def do_GET(self) -> None:
        self._handle("GET")

    def do_HEAD(self) -> None:
        self._handle("HEAD")

    def do_POST(self) -> None:
        self._handle("POST")

    def do_PUT(self) -> None:
        self._handle("PUT")

    def do_PATCH(self) -> None:
        self._handle("PATCH")

    def do_DELETE(self) -> None:
        self._handle("DELETE")

    def _handle(self, method: str) -> None:
        from . import api

        split = urllib.parse.urlsplit(self.path)
        path = urllib.parse.unquote(split.path)
        query = {
            key: values[0]
            for key, values in urllib.parse.parse_qs(split.query, keep_blank_values=True).items()
        }
        request = Request(
            method=method,
            path=path,
            query=query,
            headers=self.headers,
            rfile=self.rfile,
        )
        request.session_token = _cookie_value(self.headers.get("Cookie"), SESSION_COOKIE)

        try:
            if path.startswith("/api/"):
                response = api.dispatch(request, self.headers.get("Host"))
            else:
                response = self._pages(request)
        except errors.ApiError as error:
            response = json_response(error.status, error.body())
            if error.status == 413:
                response.close = True
        except ClientDisconnected:
            self.close_connection = True
            return
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True
            return
        self._settle_body(request, response)
        self._send(response, head_only=method == "HEAD")

    def _settle_body(self, request: Request, response: Response) -> None:
        """A body we never read would corrupt the next request on this connection."""
        remaining = request.unread_body()
        if remaining == 0:
            return
        if remaining > DRAIN_LIMIT:
            response.close = True
            return
        try:
            request.read_exactly(remaining)
        except ClientDisconnected:
            response.close = True

    def _pages(self, request: Request) -> Response:
        if request.method not in ("GET", "HEAD"):
            raise errors.not_found()
        if request.path.startswith("/static/"):
            return self._static(request.path)
        request.account = session_account(request.session_token)
        return pages.render(request)

    def _static(self, path: str) -> Response:
        relative = path[len("/static/") :]
        target = (STATIC_ROOT / relative).resolve()
        if not str(target).startswith(str(STATIC_ROOT)) or not target.is_file():
            raise errors.not_found()
        content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if target.suffix == ".woff2":
            content_type = "font/woff2"
        if target.suffix == ".js":
            content_type = "text/javascript; charset=utf-8"
        return Response(
            status=200,
            body=target.read_bytes(),
            content_type=content_type,
            headers=[("Cache-Control", "no-cache")],
        )

    def _send(self, response: Response, *, head_only: bool = False) -> None:
        body = b"" if head_only else response.body
        self.send_response(response.status)
        self.send_header("Content-Type", response.content_type)
        self.send_header("Content-Length", str(len(response.body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        for name, value in response.headers:
            self.send_header(name, value)
        if response.close:
            self.send_header("Connection", "close")
            self.close_connection = True
        self.end_headers()
        if body:
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                self.close_connection = True


class Server(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 64
    allow_reuse_address = True


def serve_forever(stop: threading.Event) -> None:
    server = Server(("0.0.0.0", CONFIG.port), Handler)
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.2})
    thread.start()
    try:
        while not stop.is_set():
            stop.wait(0.5)
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
