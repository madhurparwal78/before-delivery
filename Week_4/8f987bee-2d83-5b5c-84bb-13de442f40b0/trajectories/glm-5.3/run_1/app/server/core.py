"""Error shape, request identity and structured logging."""
from __future__ import annotations

import json
import sys
import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse, Response

_API_ERROR_STATUS = {
    "unauthenticated": 401,
    "forbidden": 403,
    "not_found": 404,
    "method_not_allowed": 405,
    "validation": 400,
    "invalid_cursor": 400,
    "precondition_required": 428,
    "version_mismatch": 412,
    "payload_too_large": 413,
    "unsupported_media_type": 415,
    "service_unavailable": 503,
}


class ApiError(Exception):
    def __init__(self, code: str, status: int, fields: dict[str, str] | None = None,
                 extra: dict | None = None, headers: dict[str, str] | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.status = status
        self.fields = fields or {}
        self.extra = extra or {}
        self.headers = headers or {}


def error_body(code: str, request_id: str, extra: dict | None = None) -> dict:
    body = {"error": code, "request_id": request_id}
    if extra:
        body.update(extra)
    return body


def json_error(status: int, code: str, request_id: str, *, fields: dict[str, str] | None = None,
               extra: dict | None = None, headers: dict[str, str] | None = None) -> JSONResponse:
    body: dict = {"error": code, "request_id": request_id}
    if fields:
        body["fields"] = fields
    if extra:
        body.update(extra)
    return JSONResponse(body, status_code=status, headers=headers)


def validation(fields: dict[str, str]) -> ApiError:
    return ApiError("validation", 400, fields=fields)


def not_found() -> ApiError:
    return ApiError("not_found", 404)


def unauthenticated() -> ApiError:
    return ApiError("unauthenticated", 401)


def forbidden() -> ApiError:
    return ApiError("forbidden", 403)


def service_unavailable() -> ApiError:
    return ApiError("service_unavailable", 503)


def _valid_request_id(raw: str | None) -> bool:
    if not raw or not (8 <= len(raw) <= 64):
        return False
    return all(ch.isalnum() or ch == "-" for ch in raw)


class RequestIdMiddleware(BaseHTTPMiddleware):
    """Assigns the request id, logs one line per request, keeps a per-request timer."""

    async def dispatch(self, request, call_next):
        raw = request.headers.get("x-request-id")
        request_id = raw if _valid_request_id(raw) else uuid.uuid4().hex[:16]
        request.state.request_id = request_id
        started = time.monotonic()
        try:
            response = await call_next(request)
        except ApiError as exc:
            response = json_error(exc.status, exc.code, request_id, fields=exc.fields,
                                  extra=exc.extra, headers=exc.headers)
        except Exception:
            response = json_error(500, "internal_error", request_id)
        duration_ms = (time.monotonic() - started) * 1000
        response.headers["X-Request-Id"] = request_id
        log_line = {
            "request_id": request_id,
            "method": request.method,
            "path": request.url.path,
            "status": response.status_code,
            "duration_ms": round(duration_ms, 2),
        }
        sys.stdout.write(json.dumps(log_line) + "\n")
        sys.stdout.flush()
        return response


def log_job_line(request_id: str, payload: dict) -> None:
    line = dict(payload)
    line["request_id"] = request_id
    sys.stdout.write(json.dumps(line) + "\n")
    sys.stdout.flush()


def with_request_id(response: Response, request_id: str) -> Response:
    response.headers["X-Request-Id"] = request_id
    return response
