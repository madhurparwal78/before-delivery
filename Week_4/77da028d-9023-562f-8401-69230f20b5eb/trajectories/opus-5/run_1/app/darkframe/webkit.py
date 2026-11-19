"""Shared Starlette plumbing: request ids, the error shape, body limits."""

from __future__ import annotations

import json
import re
import secrets
from typing import Any, Awaitable, Callable

from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp, Receive, Scope, Send

from .errors import ApiError, too_large, unsupported_media_type

REQUEST_ID_HEADER = "X-Request-Id"
_REQUEST_ID = re.compile(r"^[A-Za-z0-9-]{8,64}$")
JSON_LIMIT = 65_536
UPLOAD_LIMIT = 20_000_000
UPLOAD_CONTENT_TYPES = ("image/png", "image/jpeg", "image/fits")
MASTER_CONTENT_TYPES = ("image/fits", "application/octet-stream")
OBJECT_NAME = re.compile(r"^[A-Za-z0-9._-]{1,120}$")


def new_request_id() -> str:
    return secrets.token_hex(8)


def request_id_of(request: Request) -> str:
    return request.scope.get("darkframe_request_id") or new_request_id()


class ErrorBody(JSONResponse):
    def render(self, content: Any) -> bytes:
        return json.dumps(content, separators=(",", ":")).encode()


def json_response(
    payload: Any, status: int = 200, *, headers: dict[str, str] | None = None
) -> Response:
    return ErrorBody(payload, status_code=status, headers=headers)


def error_response(error: ApiError) -> Response:
    return ErrorBody(error.body(), status_code=error.status)


class RequestIdMiddleware:
    """Stamps every response with a request id, echoing a well-formed one."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        incoming = ""
        for key, value in scope["headers"]:
            if key == b"x-request-id":
                incoming = value.decode("latin-1")
                break
        request_id = incoming if _REQUEST_ID.match(incoming) else new_request_id()
        scope["darkframe_request_id"] = request_id

        async def send_with_id(message: dict[str, Any]) -> None:
            if message["type"] == "http.response.start":
                headers = [
                    (k, v)
                    for k, v in message.get("headers", [])
                    if k.lower() != b"x-request-id"
                ]
                headers.append((b"x-request-id", request_id.encode("latin-1")))
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_with_id)


async def api_error_handler(request: Request, exc: Exception) -> Response:
    assert isinstance(exc, ApiError)
    return error_response(exc)


async def unhandled_handler(request: Request, exc: Exception) -> Response:
    return ErrorBody(
        {
            "error": {
                "code": "internal_error",
                "message": "Darkframe could not finish that request.",
            }
        },
        status_code=500,
    )


async def not_found_handler(request: Request, exc: Exception) -> Response:
    return ErrorBody(
        {"error": {"code": "not_found", "message": "That record does not exist."}},
        status_code=404,
    )


async def read_json_body(request: Request) -> dict[str, Any]:
    """Reads a JSON body, applying the size and content-type limits in order."""
    body = await _read_limited(request, JSON_LIMIT, "The request body is too large.")
    content_type = request.headers.get("content-type", "").split(";")[0].strip()
    if content_type and content_type != "application/json":
        raise unsupported_media_type("Send this request as application/json.")
    if not body:
        return {}
    try:
        parsed = json.loads(body)
    except ValueError:
        raise unsupported_media_type("Send this request as application/json.")
    if not isinstance(parsed, dict):
        raise unsupported_media_type("Send this request as application/json.")
    return parsed


async def read_upload_body(request: Request, allowed: tuple[str, ...]) -> bytes:
    body = await _read_limited(request, UPLOAD_LIMIT, "The uploaded file is too large.")
    content_type = request.headers.get("content-type", "").split(";")[0].strip()
    if content_type not in allowed:
        raise unsupported_media_type("That file type cannot be uploaded here.")
    return body


async def _read_limited(request: Request, limit: int, message: str) -> bytes:
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > limit:
        raise too_large(message)
    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > limit:
            raise too_large(message)
        chunks.append(chunk)
    return b"".join(chunks)


Handler = Callable[[Request], Awaitable[Response]]
