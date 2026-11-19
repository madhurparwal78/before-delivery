"""The one error shape: every refusal carries `error` and `request_id`."""

from typing import Any

from fastapi.responses import JSONResponse

FIELD_NOT_ACCEPTED = "This field is not accepted here."


class ApiError(Exception):
    """A refusal raised anywhere in the server and rendered by `error_response`."""

    def __init__(self, status: int, code: str, *, fields: dict[str, str] | None = None,
                 extra: dict[str, Any] | None = None, headers: dict[str, str] | None = None) -> None:
        super().__init__(code)
        self.status = status
        self.code = code
        self.fields = fields
        self.extra = extra or {}
        self.headers = headers or {}


def validation(fields: dict[str, str]) -> ApiError:
    return ApiError(400, "validation", fields=fields)


def not_found() -> ApiError:
    return ApiError(404, "not_found")


def forbidden() -> ApiError:
    return ApiError(403, "forbidden")


def error_response(request_id: str, status: int, code: str, *, fields: dict[str, str] | None = None,
                   extra: dict[str, Any] | None = None, headers: dict[str, str] | None = None) -> JSONResponse:
    body: dict[str, Any] = {"error": code}
    if fields is not None:
        body["fields"] = fields
    body.update(extra or {})
    body["request_id"] = request_id
    return JSONResponse(body, status_code=status, headers={**(headers or {}), "X-Request-Id": request_id})


def not_ready_response(request_id: str) -> JSONResponse:
    """Health before the database is ready: a readiness report, not a refusal, so it keeps the brief's
    `{"status":"starting"}` body; every refused request still answers through `error_response`."""
    return JSONResponse({"status": "starting"}, status_code=503, headers={"X-Request-Id": request_id})


def render(request_id: str, error: ApiError) -> JSONResponse:
    return error_response(request_id, error.status, error.code, fields=error.fields, extra=error.extra,
                          headers=error.headers)
