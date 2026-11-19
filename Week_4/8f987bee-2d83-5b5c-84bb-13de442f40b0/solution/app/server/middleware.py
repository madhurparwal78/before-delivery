"""The request gateway: request identity, the stdout log line, size and type refusals, and the published
surface (404 / 405) decided before any session check."""

import json
import re
import sys
import time
import uuid
from typing import Any

from .db import db
from .errors import error_response
from .surface import allowed_methods

BODY_LIMIT = 1_000_000
REQUEST_ID = re.compile(r"[A-Za-z0-9-]{8,64}")
ASGIMessage = dict[str, Any]


def log_line(fields: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(fields, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def _header(scope: dict[str, Any], name: bytes) -> str | None:
    for key, value in scope["headers"]:
        if key == name:
            return value.decode("latin-1")
    return None


def _media_type(value: str | None) -> str:
    return (value or "").split(";", 1)[0].strip().lower()


class Gateway:
    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        started = time.perf_counter()
        path, method = scope["path"], scope["method"]
        sent = _header(scope, b"x-request-id")
        request_id = sent if sent and REQUEST_ID.fullmatch(sent) else str(uuid.uuid4())
        scope["wayline.request_id"] = request_id
        is_api = path == "/api" or path.startswith("/api/")

        async def send_logged(message: ASGIMessage) -> None:
            if message["type"] == "http.response.start":
                if is_api and not any(k == b"x-request-id" for k, _ in message.get("headers", [])):
                    message["headers"] = [*message.get("headers", []), (b"x-request-id", request_id.encode())]
                log_line({"request_id": request_id, "method": method, "path": path, "status": message["status"],
                          "duration_ms": round((time.perf_counter() - started) * 1000, 2)})
            await send(message)

        if not is_api:
            await self.app(scope, receive, send_logged)
            return

        refusal, body = await self._screen(scope, receive, request_id, path, method)
        if refusal is not None:
            await refusal(scope, receive, send_logged)
            return
        scope["wayline.body"] = body
        delivered = False

        async def replay() -> ASGIMessage:
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": body, "more_body": False}
            return await receive()

        await self.app(scope, replay, send_logged)

    async def _screen(self, scope, receive, request_id: str, path: str, method: str):
        declared = _header(scope, b"content-length")
        if declared and declared.isdigit() and int(declared) > BODY_LIMIT:
            return error_response(request_id, 413, "payload_too_large"), b""
        chunks, size = [], 0
        while True:
            message = await receive()
            if message["type"] != "http.request":
                break
            chunk = message.get("body", b"")
            size += len(chunk)
            if size > BODY_LIMIT:
                return error_response(request_id, 413, "payload_too_large"), b""
            chunks.append(chunk)
            if not message.get("more_body"):
                break
        body = b"".join(chunks)
        if body and _media_type(_header(scope, b"content-type")) != "application/json":
            return error_response(request_id, 415, "unsupported_media_type"), body
        methods = allowed_methods(path)
        if methods is None:
            return error_response(request_id, 404, "not_found"), body
        if method not in methods:
            return error_response(request_id, 405, "method_not_allowed",
                                  headers={"Allow": ", ".join(sorted(methods))}), body
        if not db.ready and path != "/api/health":
            return error_response(request_id, 503, "service_unavailable"), body
        return None, body
