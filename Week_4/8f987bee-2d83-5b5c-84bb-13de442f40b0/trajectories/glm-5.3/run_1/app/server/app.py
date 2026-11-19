"""The Wayline application."""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import threading

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, HTMLResponse, Response, JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.base import BaseHTTPMiddleware

from . import config, db, seed
from .core import ApiError, RequestIdMiddleware, json_error
from .routes import router as api_router
from .routes2 import router as api2_router

STATIC_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web", "dist")
ASSETS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets")

app = FastAPI(openapi_url=None, docs_url=None, redoc_url=None)
# a defined /api path called with another method, or a trailing slash, is never a redirect
app.router.redirect_slashes = False
app.add_middleware(RequestIdMiddleware)
app.include_router(api_router)
app.include_router(api2_router)


# ---------------------------------------------------------------- boundary

class BoundaryMiddleware(BaseHTTPMiddleware):
    """Content type, size, and no cross-origin headers."""

    async def dispatch(self, request, call_next):
        if request.method in ("POST", "PUT", "PATCH", "DELETE"):
            if request.url.path.startswith("/api"):
                if request.headers.get("content-type", "").split(";")[0].strip() not in (
                        "application/json", ""):
                    return json_error(415, "unsupported_media_type",
                                      getattr(request.state, "request_id", ""))
                body = await request.body()
                if len(body) > config.MAX_BODY_BYTES:
                    return json_error(413, "payload_too_large",
                                      getattr(request.state, "request_id", ""))
        response = await call_next(request)
        for header in ("access-control-allow-origin", "access-control-allow-credentials",
                       "access-control-allow-headers", "access-control-allow-methods"):
            if header in response.headers:
                del response.headers[header]
        return response


app.add_middleware(BoundaryMiddleware)


@app.on_event("startup")
def on_startup() -> None:
    """The watcher creates the schema, seeds and recovers whenever the database answers."""
    threading.Thread(target=db.start_watcher, args=(), daemon=True).start()


# ---------------------------------------------------------------- error handlers

@app.exception_handler(ApiError)
async def api_error_handler(request: Request, exc: ApiError):
    return json_error(exc.status, exc.code, request.state.request_id, fields=exc.fields,
                      extra=exc.extra, headers=exc.headers)


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    path = request.url.path
    if path.startswith("/api"):
        if exc.status_code == 404:
            return json_error(404, "not_found", request.state.request_id)
        if exc.status_code == 405:
            return JSONResponse({"error": "method_not_allowed",
                                 "request_id": request.state.request_id},
                                status_code=405,
                                headers={"Allow": published_allow(app, path)})
        return json_error(exc.status_code, "unknown_error", request.state.request_id)
    if exc.status_code == 404:
        return HTMLResponse(_page_shell("notfound", PRERENDER["notfound"]), status_code=404)
    return Response(status_code=exc.status_code)


def published_allow(app, path: str) -> str:
    """The Allow header names exactly the methods this brief publishes for the path."""
    allowed = set()
    for route in app.routes:
        route_path = getattr(route, "path", None)
        methods = getattr(route, "methods", None) or set()
        if not route_path:
            continue
        if route_path == path:
            allowed |= methods
            continue
        # a parametrized route such as /api/jobs/{job_id} matches by pattern
        if "{" in route_path:
            pattern = "^" + re.sub(r"\{[^}]+\}", "[^/]+", route_path) + "$"
            if re.match(pattern, path):
                allowed |= methods
    allowed -= {"HEAD", "OPTIONS", "TRACE"}
    return ", ".join(sorted(allowed))


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    if request.url.path.startswith("/api"):
        return json_error(500, "internal_error", request.state.request_id)
    return HTMLResponse(_page_shell("notfound"), status_code=500)


# ---------------------------------------------------------------- pages


def _page_shell(route_id: str, prerender: str = "") -> str:
    """The shell every page shares, with optional server-rendered content."""
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Wayline</title>
<link rel="stylesheet" href="/site.css">
</head>
<body data-page="{route_id}">
<div id="root">{prerender}</div>
<script type="module" src="/client.js"></script>
</body>
</html>"""


def _serve_index(route_id: str, prerender: str = "") -> Response:
    """Serve the page shell, with the route's headline already rendered."""
    return HTMLResponse(_page_shell(route_id, prerender))


PRERENDER: dict[str, str] = {
    "home": """
<main id="main"><section class="hero wrap">
<span class="hero-badge">14.8K STARS</span>
<h1 class="hero-h1">Keep every system in step <span class="grad">with your AI.</span></h1>
<p class="hero-sub">Link 300+ business systems to your analytics and model layers. Copy data, query it by meaning, and let agents act across the whole company. Run it in your warehouse, private cloud, or your own servers.</p>
<div class="hero-actions"><a href="/login" class="btn btn-primary">Try it free</a>
<a href="#story" class="btn btn-outline">Talk to sales</a></div>
</section></main>""",
    "connectors": """
<main id="main"><section class="section wrap">
<span class="eyebrow">Connector catalog</span>
<h1>Reach the data in every system you run.</h1>
<p class="grad" style="font-size:1.2rem;font-weight:600;">For people and agents alike.</p>
</section></main>""",
    "pricing": """
<main id="main"><section class="section wrap">
<span class="eyebrow">Pricing</span>
<h1>Plans that grow with your pipelines</h1>
<p style="max-width:64ch">Try it free for 21 days with 250 credits, roughly 60 GB of syncs. No card needed.</p>
</section></main>""",
    "connector-builder": """
<main id="main"><section class="section wrap">
<span class="eyebrow">Wayline</span>
<h1>Build and deploy custom connectors <span class="grad">in minutes, not days</span></h1>
<p style="max-width:64ch">Describe a source once and publish it as a versioned connector your whole team can use.</p>
</section></main>""",
    "data-replication": """
<main id="main"><section class="section wrap">
<span class="eyebrow">Wayline</span>
<h1>The open standard for data movement</h1>
<p style="max-width:64ch">One specification for how records move, so every connector behaves the same way.</p>
</section></main>""",
    "hybrid": """
<main id="main"><section class="section wrap">
<span class="eyebrow">Wayline</span>
<h1>Run the data plane yourself. Skip the upkeep.</h1>
<p style="max-width:64ch">Keep the console in your cloud while Wayline keeps the connectors current.</p>
</section></main>""",
    "mcp": """
<main id="main"><section class="section wrap">
<span class="eyebrow">Wayline</span>
<h1>The Wayline MCP Server</h1>
<p style="max-width:64ch">Agents read the same layer your analysts read, through one model context protocol.</p>
</section></main>""",
    "context-layer": """
<main id="main"><section class="section wrap">
<span class="eyebrow">Wayline</span>
<h1>One context layer for every agent, across every business system</h1>
<p style="max-width:64ch">Give every agent the same trusted copy of the business.</p>
</section></main>""",
    "why-open-source": """
<main id="main"><section class="section wrap">
<span class="eyebrow">Wayline</span>
<h1>Own your context.</h1>
<p style="max-width:64ch">Open code, open specs, and no lock-in.</p>
</section></main>""",
    "compare": """
<main id="main"><section class="section wrap">
<span class="eyebrow">Wayline</span>
<h1>Compare the data movement tools</h1>
<p style="max-width:64ch">A plain look at where Wayline fits.</p>
</section></main>""",
    "data-engineering-resources": """
<main id="main"><section class="section wrap">
<span class="eyebrow">Wayline</span>
<h1>All Data Engineering Resources</h1>
<p style="max-width:64ch">Guides and articles from the Wayline team.</p>
</section></main>""",
    "signin": """
<main class="signin-page"><h1 style="font-size:1.5rem;text-align:center;color:#fff">
Sign in to your Wayline account</h1>
<p style="text-align:center;color:#7c8494">Wayline runs in two planes. Choose where your workspace lives.</p></main>""",
    "login": """
<main class="wrap narrow" style="max-width:480px;padding:3rem 1.25rem">
<h1 style="font-size:1.6rem">Sign in</h1>
<p style="color:var(--muted)">Open your workspace console.</p></main>""",
    "accept-invite": """
<main class="wrap narrow" style="max-width:480px;padding:3rem 1.25rem">
<h1 style="font-size:1.6rem">Accept your invitation</h1>
<p style="color:var(--muted)">Choose a password of at least twelve characters.</p></main>""",
    "notfound": """
<main class="not-found wrap"><h1>Page not found</h1>
<p>The address you asked for does not exist.</p>
<a href="/" class="btn btn-primary">Back to home</a></main>""",
}


@app.get("/", include_in_schema=False)
def page_home():
    return _serve_index("home", PRERENDER["home"])


@app.get("/connectors", include_in_schema=False)
def page_connectors():
    return _serve_index("connectors", PRERENDER["connectors"])


@app.get("/pricing", include_in_schema=False)
def page_pricing():
    return _serve_index("pricing", PRERENDER["pricing"])


@app.get("/connector-builder", include_in_schema=False)
def page_connector_builder():
    return _serve_index("connector-builder", PRERENDER["connector-builder"])


@app.get("/data-replication", include_in_schema=False)
def page_data_replication():
    return _serve_index("data-replication", PRERENDER["data-replication"])


@app.get("/hybrid", include_in_schema=False)
def page_hybrid():
    return _serve_index("hybrid", PRERENDER["hybrid"])


@app.get("/mcp", include_in_schema=False)
def page_mcp():
    return _serve_index("mcp", PRERENDER["mcp"])


@app.get("/context-layer", include_in_schema=False)
def page_context_layer():
    return _serve_index("context-layer", PRERENDER["context-layer"])


@app.get("/why-open-source", include_in_schema=False)
def page_why_open_source():
    return _serve_index("why-open-source", PRERENDER["why-open-source"])


@app.get("/compare", include_in_schema=False)
def page_compare():
    return _serve_index("compare", PRERENDER["compare"])


@app.get("/data-engineering-resources", include_in_schema=False)
def page_resources():
    return _serve_index("data-engineering-resources", PRERENDER["data-engineering-resources"])


@app.get("/signin", include_in_schema=False)
def page_signin():
    return _serve_index("signin", PRERENDER["signin"])


@app.get("/login", include_in_schema=False)
def page_login():
    return _serve_index("login", PRERENDER["login"])


@app.get("/accept-invite", include_in_schema=False)
def page_accept_invite():
    return _serve_index("accept-invite", PRERENDER["accept-invite"])


@app.middleware("http")
async def reject_trailing_slash_redirect(request, call_next):
    """A trailing-slash or doubled-slash /api path is a 404, never a redirect."""
    path = request.url.path
    if path.startswith("/api") and (path != "/" and path.endswith("/")):
        from .core import json_error as _err
        rid = getattr(request.state, "request_id", "")
        return _err(404, "not_found", rid)
    return await call_next(request)


@app.get("/app", include_in_schema=False)
def page_app():
    return _serve_index("app")


@app.get("/app/{rest:path}", include_in_schema=False)
def page_app_nested(rest: str):
    segments = rest.split("/") if rest else []
    if len(segments) == 2 and segments[0] == "connections":
        return _serve_index("app-connection")
    if len(segments) == 1 and segments[0] == "connections":
        return _serve_index("app-new-connection")
    if len(segments) == 4 and segments[0] == "destinations" and segments[2] == "tables":
        return _serve_index("app-table")
    return _serve_index("app")


@app.get("/site.css", include_in_schema=False)
def site_css():
    target = os.path.join(STATIC_DIR, "site.css")
    if not os.path.isfile(target):
        return Response(status_code=404)
    return FileResponse(target, media_type="text/css")


@app.get("/client.js", include_in_schema=False)
def client_js():
    target = os.path.join(STATIC_DIR, "client.js")
    if not os.path.isfile(target):
        return Response(status_code=404)
    return FileResponse(target, media_type="text/javascript")


@app.get("/chunks/{filename}", include_in_schema=False)
def chunk_file(filename: str):
    target = os.path.join(STATIC_DIR, "chunks", os.path.basename(filename))
    if not os.path.isfile(target):
        return Response(status_code=404)
    return FileResponse(target, media_type="text/javascript")


@app.get("/assets/{filename}", include_in_schema=False)
def asset_file(filename: str):
    target = os.path.join(STATIC_DIR, "assets", os.path.basename(filename))
    if not os.path.isfile(target):
        return Response(status_code=404)
    return FileResponse(target)


@app.get("/media/{filename}", include_in_schema=False)
def media_file(filename: str):
    safe = os.path.basename(filename)
    if safe.endswith(".webm"):
        target = os.path.join(ASSETS_DIR,
                              "data-sonification-black-hole-at-the-center-of-the-perse-c38f6693.webm")
    elif safe.endswith(".vtt"):
        target = os.path.join(ASSETS_DIR, safe)
    elif safe.endswith(".woff2"):
        target = os.path.join(STATIC_DIR, "media", safe)
        if not os.path.isfile(target):
            target = os.path.join(ASSETS_DIR, "fonts", safe)
    else:
        return Response(status_code=404)
    if not os.path.isfile(target):
        return Response(status_code=404)
    return FileResponse(target)


@app.get("/api/health", include_in_schema=False)
def health_alias():
    from .routes import health

    return health()


FILM = "data-sonification-black-hole-at-the-center-of-the-perse-c38f6693.webm"

VTT_CAPTIONS = """WEBVTT

1
00:00:00.000 --> 00:00:08.000
Every record that moves makes a sound.

2
00:00:08.000 --> 00:00:17.000
Rising pitch means more rows are arriving.

3
00:00:17.000 --> 00:00:26.000
Quiet means the pipeline is caught up.

4
00:00:26.000 --> 00:00:34.000
Wayline turns your syncs into signal.
"""

VTT_CHAPTERS = """WEBVTT

1
00:00:00.000 --> 00:00:12.000
Arrival

2
00:00:12.000 --> 00:00:24.000
Volume

3
00:00:24.000 --> 00:00:34.000
Caught up
"""


def write_media_files() -> None:
    for name, content in (("data-in-sound.en.vtt", VTT_CAPTIONS),
                          ("data-in-sound.chapters.vtt", VTT_CHAPTERS)):
        path = os.path.join(ASSETS_DIR, name)
        if not os.path.exists(path):
            with open(path, "w", encoding="utf-8") as handle:
                handle.write(content)


write_media_files()
