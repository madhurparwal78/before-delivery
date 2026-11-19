"""Shared aiohttp plumbing: request ids, the one error body, JSON helpers and the internal service client."""
import json
import logging
import re
import uuid
from contextvars import ContextVar
from typing import Any

import aiohttp
from aiohttp import web

from darkframe.common.config import SERVICE_LABELS, Settings
from darkframe.rules.errors import ApiFault, not_found, service_unavailable, validation

REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9-]{8,64}$")
INTERNAL_CALL_SECONDS = 5
VERSION = "1.0.0"
current_request_id: ContextVar[str] = ContextVar("current_request_id", default="")
log = logging.getLogger("darkframe")


def json_response(body: Any, status: int = 200) -> web.Response:
    return web.json_response(body, status=status, dumps=lambda value: json.dumps(value, separators=(",", ":")))


def fault_response(fault: ApiFault) -> web.Response:
    return json_response(fault.body(), fault.status)


def incoming_request_id(request: web.Request) -> str:
    supplied = request.headers.get("X-Request-Id", "")
    return supplied if REQUEST_ID_PATTERN.fullmatch(supplied) else uuid.uuid4().hex


@web.middleware
async def request_context(request: web.Request, handler: Any) -> web.StreamResponse:
    request_id = incoming_request_id(request)
    current_request_id.set(request_id)
    try:
        if any("\x00" in value for value in request.match_info.values()):
            raise not_found()
        response = await handler(request)
    except ApiFault as fault:
        response = fault_response(fault)
    except (web.HTTPNotFound, web.HTTPMethodNotAllowed):
        response = fault_response(not_found())
    except Exception:
        log.exception("unhandled error on %s %s", request.method, request.path)
        response = fault_response(ApiFault(500, "internal_error", "Something went wrong on our side."))
    response.headers["X-Request-Id"] = request_id
    return response


async def read_json_object(request: web.Request) -> dict[str, Any]:
    raw = request["body"] if "body" in request else await request.read()
    if not raw.strip():
        return {}
    try:
        body = json.loads(raw)
    except ValueError as error:
        raise validation({"body": "The request body must be valid JSON."}) from error
    if not isinstance(body, dict):
        raise validation({"body": "The request body must be a JSON object."})
    return body


def imager_id(request: web.Request) -> str:
    return request.headers["X-Imager-Id"]


def health_handler(name: str) -> Any:
    async def handle(_: web.Request) -> web.Response:
        return json_response({"name": name, "version": VERSION, "status": "ok"})
    return handle


class InternalClient:
    """Calls between services. Callee refusals come back as the same ApiFault; an unreachable callee is a 503."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._session: aiohttp.ClientSession | None = None

    def session(self) -> aiohttp.ClientSession:
        if self._session is None:
            self._session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=INTERNAL_CALL_SECONDS))
        return self._session

    async def close(self) -> None:
        if self._session is not None:
            await self._session.close()

    async def raw(self, service: str, method: str, path: str, *, imager: str | None = None, body: bytes | None = None,
                  headers: dict[str, str] | None = None, query: str = "") -> tuple[int, bytes, str | None]:
        sent = {"X-Request-Id": current_request_id.get() or uuid.uuid4().hex, **(headers or {})}
        if imager is not None:
            sent["X-Imager-Id"] = imager
        try:
            async with self.session().request(method, f"{self._settings.service_url(service)}{path}{query}", data=body,
                                              headers=sent) as response:
                return response.status, await response.read(), response.headers.get("Content-Type")
        except (aiohttp.ClientError, TimeoutError) as error:
            raise service_unavailable(SERVICE_LABELS[service]) from error

    async def json(self, service: str, method: str, path: str, *, imager: str | None = None,
                   body: dict[str, Any] | None = None, query: str = "") -> Any:
        payload = None if body is None else json.dumps(body).encode()
        status, content, _ = await self.raw(service, method, path, imager=imager, body=payload, query=query,
                                            headers={"Content-Type": "application/json"} if payload else None)
        if status >= 400:
            error = json.loads(content)["error"]
            raise ApiFault(status, error["code"], error["message"], error.get("fields"),
                           {key: value for key, value in error.items() if key not in ("code", "message", "fields")})
        return json.loads(content) if content else None

