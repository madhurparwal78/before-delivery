"""The ASGI application: one origin for the pages, the API and the public media."""

from __future__ import annotations

import asyncio
import logging
import re
from pathlib import Path
from typing import Any, Awaitable, Callable

from . import emails, media, pages
from .api import handle_api
from .auth import AUTH, AuthUnavailable
from .db import DATABASE, DatabaseUnavailable
from .errors import error, internal_error, method_not_allowed, service_unavailable
from .content import read_article_cover, read_integration_icon
from .seed import seed_corpus
from .state import READINESS
from .web import Request, Response, read_request, send_response

LOGGER = logging.getLogger("relayo")

STATIC_ROOT = Path(__file__).resolve().parent / "static"
STATIC_TYPES = {
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
}
_STATIC_NAME = re.compile(r"\A[a-z0-9][a-z0-9.-]{0,63}\Z")
_SLUG = re.compile(r"\A[a-z0-9][a-z0-9-]{0,80}\Z")
_LIST_OUTAGE = "This list is unavailable right now. Try again in a minute."

PageHandler = Callable[[Request], Awaitable[Response]]

PAGE_ROUTES: dict[str, PageHandler] = {
    "/": pages.home_page,
    "/resources": pages.resources_page,
    "/integrations": pages.integrations_page,
    "/careers": pages.careers_page,
    "/press": pages.press_page,
    "/blog": pages.blog_page,
    "/partner-program": pages.partner_page,
    "/review": pages.review_page,
}

AGENT_ROUTES = (
    "sales-agent",
    "education-agent",
    "media-agent",
    "sdr-agent",
    "recruiting-agent",
)

_INTEGRATION_DETAIL = re.compile(r"\A/integration/(?P<slug>[^/]+)\Z")
_ARTICLE_DETAIL = re.compile(r"\A/blog/(?P<slug>[^/]+)\Z")
_INTEGRATION_ICON = re.compile(r"\A/media/integrations/(?P<slug>[^/]+)\.svg\Z")
_ARTICLE_COVER = re.compile(r"\A/media/articles/(?P<slug>[^/]+)\.svg\Z")
_STATIC_PATH = re.compile(r"\A/static/(?P<name>[^/]+)\Z")


async def _handle_page(request: Request) -> Response:
    path = request.path
    handler = PAGE_ROUTES.get(path)
    if handler is not None:
        return await handler(request)

    agent = path[1:]
    if agent in AGENT_ROUTES:
        return await pages.agent_page(request, agent)

    found = _INTEGRATION_DETAIL.match(path)
    if found is not None:
        return await pages.integration_detail_page(request, found["slug"])

    found = _ARTICLE_DETAIL.match(path)
    if found is not None:
        return await pages.article_page(request, found["slug"])

    return pages.not_found_page()


async def _handle_media(request: Request, path: str) -> Response | None:
    """Icons and covers, checked against the database on every request."""
    found = _INTEGRATION_ICON.match(path)
    if found is not None and _SLUG.match(found["slug"]) is not None:
        async with DATABASE.acquire() as connection:
            row = await read_integration_icon(connection, found["slug"])
        if row is not None:
            return _svg(media.integration_icon(row["slug"], row["name"]))

    found = _ARTICLE_COVER.match(path)
    if found is not None and _SLUG.match(found["slug"]) is not None:
        async with DATABASE.acquire() as connection:
            row = await read_article_cover(connection, found["slug"])
        if row is not None:
            return _svg(media.article_cover(row["slug"], row["title"]))

    if path.startswith("/media/integrations/") or path.startswith("/media/articles/"):
        return pages.not_found_page()
    return None


def _svg(body: bytes) -> Response:
    return Response(
        status=200,
        body=body,
        content_type="image/svg+xml",
        headers=[("Cache-Control", "no-cache")],
    )


def _handle_static(name: str) -> Response:
    if _STATIC_NAME.match(name) is None:
        return pages.not_found_page()
    suffix = Path(name).suffix
    if suffix not in STATIC_TYPES:
        return pages.not_found_page()
    target = (STATIC_ROOT / name).resolve()
    if target.parent != STATIC_ROOT or not target.is_file():
        return pages.not_found_page()
    return Response(
        status=200,
        body=target.read_bytes(),
        content_type=STATIC_TYPES[suffix],
        headers=[("Cache-Control", "no-cache")],
    )


async def _route(request: Request) -> Response:
    path = request.path

    if path.startswith("/api/"):
        return await handle_api(request)

    if request.method not in ("GET", "HEAD"):
        return method_not_allowed(["GET", "HEAD"])

    static = _STATIC_PATH.match(path)
    if static is not None:
        return _handle_static(static["name"])

    media_answer = await _handle_media(request, path)
    if media_answer is not None:
        return media_answer

    return await _handle_page(request)


def _is_private(path: str) -> bool:
    return path.startswith("/api/auth/") or path.startswith("/api/review/")


async def _answer(request: Request) -> Response:
    try:
        response = await _route(request)
    except DatabaseUnavailable:
        LOGGER.warning("database unavailable while answering %s", request.path)
        response = (
            service_unavailable()
            if request.path.startswith("/api/") or request.path.startswith("/media/")
            else pages.outage_page("Relayo is unavailable right now", _LIST_OUTAGE)
        )
    except AuthUnavailable:
        LOGGER.warning("auth service unavailable while answering %s", request.path)
        response = error(503, "auth_unavailable")
    except Exception:
        LOGGER.exception("unexpected failure while answering %s", request.path)
        response = internal_error()

    if _is_private(request.path):
        response.with_header("Cache-Control", "no-store")
        response.drop_headers(["ETag", "Last-Modified"])
    return response


async def application(scope: dict[str, Any], receive: Any, send: Any) -> None:
    if scope["type"] == "lifespan":
        await _lifespan(scope, receive, send)
        return
    request = await read_request(scope, receive)
    response = await _answer(request)
    await send_response(send, response, head=request.method == "HEAD")


async def _lifespan(scope: dict[str, Any], receive: Any, send: Any) -> None:
    stopping = asyncio.Event()
    tasks: list[asyncio.Task[None]] = []
    while True:
        message = await receive()
        if message["type"] == "lifespan.startup":
            tasks.append(asyncio.create_task(_prepare(stopping)))
            tasks.append(asyncio.create_task(emails.run_delivery_loop(stopping)))
            await send({"type": "lifespan.startup.complete"})
        elif message["type"] == "lifespan.shutdown":
            stopping.set()
            for task in tasks:
                task.cancel()
            await DATABASE.close()
            await AUTH.close()
            await send({"type": "lifespan.shutdown.complete"})
            return


async def _prepare(stopping: asyncio.Event) -> None:
    """Create the schema and seed the corpus and accounts, retrying until both answer."""
    while not stopping.is_set():
        try:
            await DATABASE.connect()
            await DATABASE.create_schema()
            async with DATABASE.acquire() as connection:
                await seed_corpus(connection)
            await AUTH.ensure_seed_identities()
        except (DatabaseUnavailable, AuthUnavailable) as exc:
            LOGGER.warning("start-up waiting for a backing service: %s", exc)
            await asyncio.sleep(3)
            continue
        READINESS.ready = True
        LOGGER.info("relayo is ready")
        return
