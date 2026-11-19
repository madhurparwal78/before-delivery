"""The shared shape of an internal service: health, error bodies, request ids."""

from __future__ import annotations

from typing import Any, Awaitable, Callable, Sequence

from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import BaseRoute, Route

from .config import VERSION
from .errors import ApiError
from .httpclient import HttpError, request as http_request
from .webkit import (
    RequestIdMiddleware,
    api_error_handler,
    json_response,
    not_found_handler,
    unhandled_handler,
)

IMAGER_HEADER = "X-Darkframe-Imager"


def imager_of(request: Request) -> str:
    return request.headers.get(IMAGER_HEADER, "")


def build_service(
    name: str,
    routes: Sequence[BaseRoute],
    *,
    on_startup: Sequence[Callable[[], Awaitable[None]]] = (),
) -> Starlette:
    async def health(_: Request) -> Response:
        return json_response({"name": name, "version": VERSION, "status": "ok"})

    return Starlette(
        routes=[*routes, Route("/internal/health", health)],
        middleware=[Middleware(RequestIdMiddleware)],
        exception_handlers={
            ApiError: api_error_handler,
            404: not_found_handler,
            Exception: unhandled_handler,
        },
        on_startup=list(on_startup),
    )


async def call_service(
    base_url: str,
    method: str,
    path: str,
    *,
    imager_id: str = "",
    body: bytes = b"",
    content_type: str = "application/json",
    request_id: str = "",
    timeout: float = 5.0,
) -> Any:
    headers = {}
    if imager_id:
        headers[IMAGER_HEADER] = imager_id
    if request_id:
        headers["X-Request-Id"] = request_id
    if body:
        headers["Content-Type"] = content_type
    return await http_request(
        method, f"{base_url}{path}", headers=headers, body=body, timeout=timeout
    )


__all__ = [
    "IMAGER_HEADER",
    "HttpError",
    "build_service",
    "call_service",
    "imager_of",
    "VERSION",
]
