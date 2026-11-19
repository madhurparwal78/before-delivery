"""The built browser files and the page shell. Nothing outside dist/ is ever served."""
import re
from pathlib import Path

from aiohttp import web

from darkframe.gateway.auth import Keys
from darkframe.rules.errors import not_found

DIST = Path(__file__).resolve().parents[2] / "dist"
PRIVATE_PAGES = re.compile(r"^/(plan|projects(/[^/]+)?|sessions|library|site)$")
PUBLIC_PAGES = re.compile(r"^/(unlock|s/[^/]+)$")
CONTENT_TYPES = {".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml",
                 ".html": "text/html"}
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
}


def file_response(request: web.Request, path: Path) -> web.Response:
    stat = path.stat()
    etag = f'"{stat.st_mtime_ns:x}-{stat.st_size:x}"'
    headers = {"ETag": etag, "Cache-Control": "no-cache", "Vary": "Accept-Encoding", **SECURITY_HEADERS}
    if request.headers.get("If-None-Match") == etag:
        return web.Response(status=304, headers=headers)
    compressed = path.with_name(path.name + ".gz")
    if "gzip" in request.headers.get("Accept-Encoding", "") and compressed.exists():
        headers["Content-Encoding"] = "gzip"
        body = compressed.read_bytes()
    else:
        body = path.read_bytes()
    return web.Response(body=body, headers=headers, content_type=CONTENT_TYPES[path.suffix])


def redirect(location: str) -> web.Response:
    return web.Response(status=302, headers={"Location": location, "Cache-Control": "no-store"})


class Pages:
    def __init__(self, keys: Keys) -> None:
        self.keys = keys

    def add_to(self, app: web.Application) -> None:
        app.add_routes([web.get("/assets/{path:.+}", self.asset), web.get("/{path:.*}", self.page)])

    async def asset(self, request: web.Request) -> web.Response:
        target = (DIST / "assets" / request.match_info["path"]).resolve()
        if not target.is_relative_to(DIST / "assets") or not target.is_file() or target.suffix not in CONTENT_TYPES:
            raise not_found()
        return file_response(request, target)

    async def page(self, request: web.Request) -> web.Response:
        if request.path == "/":
            return redirect("/plan" if await self.keys.authenticate(request) else "/unlock")
        if PRIVATE_PAGES.match(request.path):
            if await self.keys.authenticate(request) is None:
                return redirect("/unlock")
        elif not PUBLIC_PAGES.match(request.path):
            raise not_found()
        return file_response(request, DIST / "index.html")
