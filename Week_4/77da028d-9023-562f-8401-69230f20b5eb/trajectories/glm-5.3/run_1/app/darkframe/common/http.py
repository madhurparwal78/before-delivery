"""Shared HTTP plumbing for all four services."""
from __future__ import annotations

import json
import os
import secrets
import uuid
from typing import Any, Optional

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, fields: Optional[dict] = None,
                 extra: Optional[dict] = None) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.fields = fields
        self.extra = extra or {}

    def body(self) -> dict:
        err: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.fields:
            err["fields"] = self.fields
        for key, value in self.extra.items():
            err[key] = value
        return {"error": err}


def error_response(err: ApiError, request_id: str) -> JSONResponse:
    return JSONResponse(err.body(), status_code=err.status, headers={"X-Request-Id": request_id})


def new_request_id() -> str:
    return uuid.uuid4().hex


def echo_request_id(request: Request) -> str:
    sent = request.headers.get("x-request-id", "")
    if 8 <= len(sent) <= 64 and all(c.isalnum() or c == "-" for c in sent):
        return sent
    return new_request_id()


def json_error(status: int, code: str, message: str, fields: Optional[dict] = None) -> JSONResponse:
    err = ApiError(status, code, message, fields)
    return error_response(err, new_request_id())


async def read_json(request: Request, limit: int = 65536) -> Any:
    raw = await request.body()
    if len(raw) > limit:
        raise ApiError(413, "too_large", "That request body is too large.")
    if not raw:
        return {}
    content_type = request.headers.get("content-type", "")
    if content_type.split(";")[0].strip().lower() != "application/json":
        raise ApiError(415, "unsupported_media_type", "Send the body as application/json.")
    try:
        return json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        raise ApiError(422, "validation", "The body is not valid JSON.", {"body": "The body is not valid JSON."})


def fail(status: int, code: str, message: str, fields: Optional[dict] = None, **extra: Any) -> None:
    raise ApiError(status, code, message, fields, extra)


def gen_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(10)}"


def gen_token(n: int = 32) -> str:
    alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-"
    return "".join(secrets.choice(alphabet) for _ in range(n))


def build_app(routes, service_name: str, lifespan=None) -> Starlette:
    
    async def on_error(request: Request, exc: Exception) -> Response:
        if isinstance(exc, ApiError):
            return error_response(exc, request.scope.get("request_id", new_request_id()))
        return json_error(500, "internal_error", "Something went wrong on the server.")

    app = Starlette(routes=routes, exception_handlers={ApiError: on_error, Exception: on_error},
                    lifespan=lifespan)
    app.state.service_name = service_name
    return app


async def call_internal(client: Any, method: str, path: str, *, json_body: Any = None,
                        params: Any = None, headers: Optional[dict] = None,
                        timeout: float = 5.0) -> tuple[int, Any, dict]:
    """One internal call that raises ApiError on timeout with the service's name."""
    try:
        response = await client.request(method, path, json=json_body, params=params,
                                        headers=headers or {}, timeout=timeout)
    except Exception:
        raise ApiError(503, "service_unavailable", "Try again in a moment.")
    body: Any = None
    if response.content:
        try:
            body = response.json()
        except ValueError:
            body = None
    return response.status_code, body, dict(response.headers)


def env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    try:
        return int(raw) if raw else default
    except (TypeError, ValueError):
        return default
