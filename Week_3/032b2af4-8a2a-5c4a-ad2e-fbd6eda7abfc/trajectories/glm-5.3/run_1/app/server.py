"""HTTP server: routing, static pages and media, and the JSON API of Pacely."""
import json
import os
import sys
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlsplit

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import lib.seed  # noqa: E402  (schema applied on start)
from lib import store  # noqa: E402
from lib.errors import ApiError, error_response  # noqa: E402

MAX_BODY_BYTES = 5_000_000
STATIC_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
ASSET_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets")

from web import (ROUTES, PATH_TEMPLATES, build_path_templates, match_route,  # noqa: E402
                 json_response, iso, require_session, athlete_self, str_field, route)

PUBLIC_ROUTES = {"/api/auth/signup", "/api/auth/login", "/api/auth/logout"}


# ---------------------------------------------------------------- request handling
CONTENT_TYPES = {
    ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg", ".webp": "image/webp", ".webm": "video/webm",
    ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".woff2": "font/woff2",
    ".vtt": "text/vtt", ".json": "application/json", ".html": "text/html; charset=utf-8",
    ".gpx": "application/gpx+xml", ".txt": "text/plain; charset=utf-8",
}


class PacelyHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "Pacely"

    def log_message(self, fmt, *args):
        pass

    def _read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY_BYTES:
            # drain what we can so the connection stays usable, then refuse
            self.rfile.read(min(length, MAX_BODY_BYTES))
            self.close_connection = True
            raise ApiError(413, "payload_too_large")
        raw = self.rfile.read(length) if length else b""
        self.raw_body = raw
        if not raw:
            return {}
        try:
            parsed = json.loads(raw.decode("utf-8"))
        except Exception:
            raise ApiError(400, "validation")
        if not isinstance(parsed, dict):
            raise ApiError(400, "validation")
        return parsed

    def _dispatch(self, method: str):
        split = urlsplit(self.path)
        path = unquote(split.path)
        self.parsed_query = parse_qs(split.query)
        self.path_params = {}
        self.raw_body = b""
        try:
            if path == "/api/health" and method == "GET":
                self._send(json_response({"status": "ok"}))
                return
            if path.startswith("/api/"):
                fn, params = match_route(method, path)
                if fn is None:
                    raise ApiError(404, "not_found")
                self.path_params = params
                body = self._read_body() if method in ("POST", "PUT", "PATCH", "DELETE") else {}
                if path not in PUBLIC_ROUTES:
                    me = require_session(self)
                else:
                    me = None
                status, headers, payload = fn(self, body, me)
                self._send((status, headers, payload))
                return
            self._serve_page(method, path)
        except ApiError as err:
            self._send(error_response(err.status, err.code, err.fields, err.message))
        except BrokenPipeError:
            pass
        except Exception:
            traceback.print_exc()
            self._send(error_response(500, "server_error"))

    def _send(self, response):
        status, headers, payload = response
        try:
            self.send_response(status)
            seen = set()
            for k, v in headers:
                if k in seen:
                    continue
                seen.add(k)
                self.send_header(k, v)
            if "Content-Length" not in {k for k, _ in headers}:
                self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            if payload:
                self.wfile.write(payload)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _serve_page(self, method: str, path: str):
        if method not in ("GET", "HEAD"):
            self._send(error_response(405, "method_not_allowed"))
            return
        # static assets under /assets/ (media, fonts, scripts) and /media/ (captions)
        if path.startswith("/assets/") or path.startswith("/media/"):
            root = ASSET_ROOT if path.startswith("/assets/") else os.path.join(STATIC_ROOT, "media")
            rel = path.split("/", 2)[2] if path.count("/") >= 2 else ""
            target = os.path.normpath(os.path.join(root, rel))
            if not target.startswith(os.path.abspath(root)) or not os.path.isfile(target):
                self._send(not_found_page())
                return
            ext = os.path.splitext(target)[1].lower()
            ctype = CONTENT_TYPES.get(ext, "application/octet-stream")
            with open(target, "rb") as f:
                data = f.read()
            headers = [("Content-Type", ctype)]
            if ext in (".woff2", ".webm", ".jpg", ".jpeg", ".mp3", ".svg"):
                headers.append(("Cache-Control", "public, max-age=3600"))
            self._send((200, headers, data))
            return
        if path.startswith("/api"):
            self._send(error_response(404, "not_found"))
            return
        # a static marketing page by name
        clean = path.strip("/")
        if not clean:
            page = os.path.join(STATIC_ROOT, "index.html")
        else:
            page = os.path.join(STATIC_ROOT, clean + ".html")
            if "/" in clean or not os.path.isfile(page):
                page = None
        if page and os.path.isfile(page):
            with open(page, "rb") as f:
                data = f.read()
            self._send((200, [("Content-Type", "text/html; charset=utf-8")], data))
            return
        # signed-in product routes live in the app shell
        APP_ROUTES = ("/dashboard", "/upload", "/activities", "/segments", "/athletes", "/recap",
                      "/settings")
        if any(path == r or path.startswith(r + "/") for r in APP_ROUTES):
            with open(os.path.join(STATIC_ROOT, "app.html"), "rb") as f:
                data = f.read()
            self._send((200, [("Content-Type", "text/html; charset=utf-8")], data))
            return
        self._send(not_found_page())

    def do_GET(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")

    def do_PUT(self):
        self._dispatch("PUT")

    def do_PATCH(self):
        self._dispatch("PATCH")

    def do_DELETE(self):
        self._dispatch("DELETE")

    def do_HEAD(self):
        self._dispatch("GET")


def not_found_page() -> tuple:
    page_path = os.path.join(STATIC_ROOT, "404.html")
    if os.path.isfile(page_path):
        with open(page_path, "rb") as f:
            data = f.read()
        return 404, [("Content-Type", "text/html; charset=utf-8")], data
    return 404, [("Content-Type", "text/html; charset=utf-8")], b"<h1>Not found</h1>"


def main():
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise SystemExit("DATABASE_URL is required")
    port = int(os.environ.get("APP_PUBLIC_PORT") or 4173)
    store.init_pool(database_url)
    with store.conn() as c:
        from lib.schema import SCHEMA
        c.execute(SCHEMA)
    lib.seed.seed()
    import api_auth, api_social, api_engage, api_features  # noqa: F401
    build_path_templates()
    httpd = ThreadingHTTPServer(("0.0.0.0", port), PacelyHandler)
    print(f"Pacely serving on 0.0.0.0:{port}", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=None)
    args, unknown = parser.parse_known_args()
    os.environ.setdefault("APP_PUBLIC_PORT", str(args.port) if args.port else "4173")
    main()
