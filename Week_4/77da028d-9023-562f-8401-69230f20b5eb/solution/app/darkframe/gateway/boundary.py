"""The server boundary: body size, content type and same-origin rules, in the brief's error precedence."""
import re
from typing import Any
from urllib.parse import urlsplit

from aiohttp import web

from darkframe.rules.errors import PRECEDENCE_MESSAGES, ApiFault

JSON_LIMIT = 65_536
UPLOAD_LIMIT = 20_000_000
DRAIN_LIMIT = 64_000_000
JSON_TYPES = frozenset({"application/json"})
FRAME_TYPES = frozenset({"image/png", "image/jpeg", "image/fits"})
MASTER_TYPES = frozenset({"image/fits", "application/octet-stream"})
STATE_CHANGING = frozenset({"POST", "PUT", "PATCH", "DELETE"})
FRAME_ROUTE = re.compile(r"^/api/batches/[^/]+/frames/[^/]+$")
MASTER_ROUTE = re.compile(r"^/api/calibration-sets/[^/]+/master$")


def policy(method: str, path: str) -> tuple[int, frozenset[str]]:
    if method == "PUT" and FRAME_ROUTE.match(path):
        return UPLOAD_LIMIT, FRAME_TYPES
    if method == "PUT" and MASTER_ROUTE.match(path):
        return UPLOAD_LIMIT, MASTER_TYPES
    return JSON_LIMIT, JSON_TYPES


async def drain(request: web.Request) -> None:
    drained = 0
    async for chunk in request.content.iter_chunked(1 << 16):
        drained += len(chunk)
        if drained > DRAIN_LIMIT:
            break


async def read_body(request: web.Request) -> bytes:
    """Apply 413, 415 and the same-origin rule (in that order), then return the body."""
    limit, types = policy(request.method, request.path)
    declared = request.content_length
    if declared is not None and declared > limit:
        await drain(request)
        raise ApiFault(413, "too_large", PRECEDENCE_MESSAGES["too_large"])
    parts: list[bytes] = []
    received = 0
    async for chunk in request.content.iter_chunked(1 << 16):
        parts.append(chunk)
        received += len(chunk)
        if received > limit:
            break
    body = b"".join(parts)
    if len(body) > limit:
        await drain(request)
        raise ApiFault(413, "too_large", PRECEDENCE_MESSAGES["too_large"])
    media_type = request.headers.get("Content-Type", "").split(";")[0].strip().lower()
    if body and media_type not in types:
        raise ApiFault(415, "unsupported_media_type", PRECEDENCE_MESSAGES["unsupported_media_type"])
    origin = request.headers.get("Origin")
    if request.method in STATE_CHANGING and origin and urlsplit(origin).netloc != request.host:
        raise ApiFault(403, "cross_origin", "Requests must come from Darkframe itself.")
    return body


@web.middleware
async def enforce_boundary(request: web.Request, handler: Any) -> web.StreamResponse:
    """Every /api request passes the size, type and origin rules before any route sees it; the body is kept on the request."""
    if request.path.startswith("/api/"):
        request["body"] = await read_body(request)
    return await handler(request)
