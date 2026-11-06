"""The one place an API error body is built."""

from typing import Any, cast

from starlette.requests import Request
from starlette.responses import JSONResponse


class ApiError(Exception):
    """A refusal with its status, code and the published extras (fields, scan_id, version)."""

    def __init__(self, status: int, code: str, **extra: Any) -> None:
        super().__init__(code)
        self.status = status
        self.code = code
        self.extra = extra


class StorageUnavailable(ApiError):
    def __init__(self) -> None:
        super().__init__(503, "storage_unavailable")


def not_found() -> ApiError:
    return ApiError(404, "not_found")


def method_not_allowed() -> ApiError:
    return ApiError(405, "method_not_allowed")


def unauthenticated() -> ApiError:
    return ApiError(401, "unauthenticated")


def validation_failed(fields: dict[str, str]) -> ApiError:
    return ApiError(422, "validation_failed", fields=fields)


async def handle_api_error(_request: Request, error: Exception) -> JSONResponse:
    api_error = cast(ApiError, error)
    return JSONResponse({"error": api_error.code, **api_error.extra}, status_code=api_error.status)
