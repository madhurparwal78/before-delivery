"""The production server: one origin for pages, assets, media and the API."""

import argparse
import json
import os
import sys
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit

from . import db, errors
from . import handlers  # registers every published route
from .api import dispatch
from .app import APP
from .pages import (FAVICON_SVG, page_for_path, static_bytes, media_bytes, SSE_HEARTBEAT)

MAX_BODY = 16384


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "NightWard"
    sys_version = ""

    def log_message(self, fmt, *args):
        pass

    # --- request body ----------------------------------------------------

    def _body(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length > MAX_BODY:
            return None, False
        return self.rfile.read(length) if length else b"", True

    # --- response helpers -------------------------------------------------

    def _send(self, status, body, content_type, extra=(), head=False):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        for key, value in extra:
            self.send_header(key, value)
        self.end_headers()
        if not head:
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def _send_json(self, status, payload, extra=(), personal=False):
        body = (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8")
        headers = list(extra)
        if personal or self.headers.get("Authorization") or status == 401:
            headers.append(("Cache-Control", "no-store"))
        self._send(status, body, "application/json; charset=utf-8", headers)

    # --- dispatch ---------------------------------------------------------

    def do_GET(self):
        self._handle("GET")

    def do_HEAD(self):
        self._handle("HEAD")

    def do_POST(self):
        self._handle("POST")

    def do_PUT(self):
        self._handle("PUT")

    def do_DELETE(self):
        self._handle("DELETE")

    def do_PATCH(self):
        self._handle("PATCH")

    def do_OPTIONS(self):
        self._handle("OPTIONS")

    def _handle(self, method):
        split = urlsplit(self.path)
        path = unquote(split.path)
        if path.startswith("/api"):
            self._api(method, split)
            return
        if method not in ("GET", "HEAD"):
            self._send_json(405, {"error": "method_not_allowed"},
                            [("Allow", "GET, HEAD")])
            return
        try:
            self._page(method, split)
        except db.OutOfService:
            self._page(method, split, outage=True)

    def _page(self, method, split, outage=False):
        path = unquote(split.path)
        if path.startswith("/static/") or path == "/favicon.ico":
            self._static(path, method)
            return
        if path.startswith("/assets/") or path == "/media/briefing.vtt":
            self._media(path, method)
            return
        status, body, extra, head_or_json = page_for_path(path, split.query, outage)
        if head_or_json == "json":
            self._send_json(status, body, extra)
            return
        self._send(status, body, "text/html; charset=utf-8", extra, head=method == "HEAD")

    def _static(self, path, method):
        result = static_bytes(path)
        if result is None and path == "/favicon.ico":
            body = FAVICON_SVG.encode("utf-8")
            self._send(200, body, "image/svg+xml", [], head=method == "HEAD")
            return
        if result is None:
            self._send(404, NOT_FOUND_HTML, "text/html; charset=utf-8", [])
            return
        body, ctype = result
        self._send(200, body, ctype, [("Cache-Control", "public, max-age=300")],
                   head=method == "HEAD")

    def _media(self, path, method):
        result = media_bytes(path)
        if result is None:
            self._send(404, NOT_FOUND_HTML, "text/html; charset=utf-8", [])
            return
        body, ctype, extra = result
        self._send(200, body, ctype, extra, head=method == "HEAD")

    def _api(self, method, split):
        path = unquote(split.path)
        if path == "/api/stream":
            self._stream(method, split)
            return
        environ = self._environ(method, split)
        if environ is None:
            return
        try:
            status, payload, headers = dispatch(method, path, split.query, environ)
            body = payload if not isinstance(payload, dict) else \
                (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8")
            extra = strip_content_type(headers)
            content_type = content_type_from(headers, "application/json; charset=utf-8")
            if self._personal(path) or self.headers.get("Authorization"):
                extra = extra + [("Cache-Control", "no-store")]
            self._send(status, body, content_type, extra)
        except errors.ApiError as err:
            self._send_json(err.status, err.body(), err.headers or [])
        except db.OutOfService:
            self._send_json(503, {"error": "unavailable"}, [])
        except Exception:
            traceback.print_exc(file=sys.stderr)
            self._send_json(503, {"error": "unavailable"}, [])

    def _personal(self, path):
        """Every personal route: its response is never cached."""
        return (path.startswith("/api/auth") or path.startswith("/api/me") or
                path.startswith("/api/teams") or path == "/api/webinar/flag" or
                path.endswith("/flag"))

    def _stream(self, method, split):
        if method not in ("GET", "HEAD"):
            self._send_json(405, {"error": "method_not_allowed"},
                            [("Allow", "GET, HEAD")])
            return
        if not APP.ready.is_set():
            self._send_json(503, {"error": "starting"}, [])
            return
        if not APP.db_ok:
            self._send_json(503, {"error": "unavailable"}, [])
            return
        queue = APP.streams.subscribe()
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        self.close_connection = True
        try:
            self.wfile.write(b"retry: 2000\n\n")
            last = time.monotonic()
            while not APP.closing:
                if not APP.db_ok:
                    # Open streams close when the database is lost.
                    break
                try:
                    item = queue.get(timeout=0.5)
                except Exception:
                    item = None
                if item is not None:
                    self.wfile.write(item.encode("utf-8") + b"\n\n")
                    self.wfile.flush()
                    last = time.monotonic()
                if time.monotonic() - last >= SSE_HEARTBEAT:
                    self.wfile.write(b": keep-alive\n\n")
                    self.wfile.flush()
                    last = time.monotonic()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            APP.streams.unsubscribe(queue)

    def _environ(self, method, split):
        raw = None
        ok = True
        if method in ("POST", "PUT", "PATCH", "DELETE"):
            raw, ok = self._body()
            if not ok:
                self._send_json(413, {"error": "payload_too_large"}, [])
                return None
        environ = {
            "REQUEST_METHOD": method,
            "PATH_INFO": split.path,
            "QUERY_STRING": split.query,
            "CONTENT_TYPE": self.headers.get("Content-Type", ""),
            "CONTENT_LENGTH": self.headers.get("Content-Length") or "0",
            "HTTP_AUTHORIZATION": self.headers.get("Authorization", ""),
            "wsgi.input": _BytesReader(raw or b""),
            "downtime.slug": "",
            "downtime.user_id": "",
        }
        return environ


class _BytesReader:
    def __init__(self, data):
        self.data = data

    def read(self, size=-1):
        return self.data


def content_type_from(headers, default="application/octet-stream"):
    for key, value in headers:
        if key.lower() == "content-type":
            return value
    return default


def strip_content_type(headers):
    return [(key, value) for key, value in headers
            if key.lower() != "content-type"]


NOT_FOUND_HTML = b"<h1>Not found</h1>"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int,
                        default=int(os.environ.get("APP_PUBLIC_PORT") or 4173))
    args = parser.parse_args()
    background = threading.Thread(target=APP.background_loop, daemon=True)
    background.start()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.daemon_threads = True
    print("serving on %s:%d" % (args.host, args.port), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        APP.close_all()


if __name__ == "__main__":
    main()
