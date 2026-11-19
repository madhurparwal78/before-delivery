"""The server boundary: request identity, size and type limits, routing refusals and stdout logs."""

from __future__ import annotations

import json
import sys
import time
import uuid
from typing import Any

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .db import database
from .errors import ApiError
from .published import is_interface_path, surface_methods
from .validation import REQUEST_ID

MAX_BODY_BYTES = 1_000_000
JSON_MEDIA_TYPE = "application/json"
HEALTH_PATH = "/api/health"


class Boundary:
    """One ASGI layer in front of routing, so undefined paths and methods never reach a handler."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = {key.decode("latin-1").lower(): value.decode("latin-1") for key, value in scope["headers"]}
        request_id = _request_id(headers.get("x-request-id"))
        scope["state"] = {"request_id": request_id}
        started = time.monotonic()
        status_holder: dict[str, int] = {}

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                status_holder["status"] = message["status"]
                message.setdefault("headers", [])
                message["headers"].append((b"x-request-id", request_id.encode()))
            await send(message)

        refusal = self._refusal(scope, headers)
        if refusal is not None:
            await _send_error(send_wrapper, refusal, request_id)
        else:
            await self.app(scope, receive, send_wrapper)
        _log_request(request_id, scope, status_holder.get("status", 500), time.monotonic() - started)

    def _refusal(self, scope: Scope, headers: dict[str, str]) -> ApiError | None:
        content_length = headers.get("content-length")
        if content_length is not None and content_length.isdigit() and int(content_length) > MAX_BODY_BYTES:
            return ApiError("payload_too_large")
        has_body = content_length is not None and content_length.isdigit() and int(content_length) > 0
        if has_body:
            media_type = headers.get("content-type", "").split(";")[0].strip().lower()
            if media_type != JSON_MEDIA_TYPE:
                return ApiError("unsupported_media_type")
        path: str = scope["path"]
        if not is_interface_path(path):
            return None
        methods = surface_methods(path)
        if methods is None:
            return ApiError("not_found")
        if scope["method"] not in methods:
            return ApiError("method_not_allowed", headers={"Allow": ", ".join(sorted(methods))})
        if path.startswith("/api/") and path != HEALTH_PATH and not database.ready:
            return ApiError("service_unavailable")
        return None


def _request_id(presented: str | None) -> str:
    if presented is not None and REQUEST_ID.match(presented):
        return presented
    return str(uuid.uuid4())


async def _send_error(send: Send, error: ApiError, request_id: str) -> None:
    body = json.dumps(error.body(request_id)).encode()
    raw_headers = [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]
    raw_headers.extend((key.lower().encode(), value.encode()) for key, value in error.headers.items())
    await send({"type": "http.response.start", "status": error.status, "headers": raw_headers})
    await send({"type": "http.response.body", "body": body})


def _log_request(request_id: str, scope: Scope, status: int, duration: float) -> None:
    line: dict[str, Any] = {
        "request_id": request_id,
        "method": scope["method"],
        "path": scope["path"],
        "status": status,
        "duration_ms": round(duration * 1000, 3),
    }
    sys.stdout.write(json.dumps(line) + "\n")
    sys.stdout.flush()
