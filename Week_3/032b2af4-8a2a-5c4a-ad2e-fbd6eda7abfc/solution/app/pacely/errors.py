"""One shared error shape: every API error is JSON carrying an `error` string."""

from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.responses import JSONResponse


class ApiError(Exception):
    def __init__(self, status: int, error: str, **extra):
        self.status = status
        self.body = {"error": error, **extra}


def validation(fields: dict[str, str]) -> ApiError:
    return ApiError(400, "validation", fields=fields)


def not_found() -> ApiError:
    return ApiError(404, "not_found")


def forbidden() -> ApiError:
    return ApiError(403, "forbidden")


def unauthorized() -> ApiError:
    return ApiError(401, "unauthorized")


def invalid_body() -> ApiError:
    return ApiError(400, "validation")


def payload_too_large() -> ApiError:
    return ApiError(413, "payload_too_large")


def is_api(request: Request) -> bool:
    return request.url.path.startswith("/api/")


async def api_error_response(request: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse(exc.body, status_code=exc.status)


HTTP_NAMES = {404: "not_found", 405: "method_not_allowed"}


def http_error_body(exc: HTTPException) -> dict:
    return {"error": HTTP_NAMES.get(exc.status_code, "error")}
