"""The one shared refusal body for every API error."""

from __future__ import annotations

import json
from typing import Mapping

from starlette.responses import Response

MESSAGES: Mapping[str, str] = {
    "unauthorized": "Sign in to continue.",
    "invalid_credentials": "That email and password do not match.",
    "payment_declined": "Your card was declined.",
    "forbidden": "You do not have permission to do that.",
    "entitlement_required": "Your membership tier does not include this.",
    "not_found": "Not found.",
    "method_not_allowed": "Method not allowed.",
    "conflict": "That conflicts with the current state.",
    "payload_too_large": "That is too large.",
    "unsupported_media_type": "That content type is not supported.",
    "range_not_satisfiable": "That range is not satisfiable.",
    "validation_failed": "Check the named field.",
    "rate_limited": "Too many requests. Try again later.",
}


class ApiError(Exception):
    """A refused API request, carrying the status and code of its refusal."""

    def __init__(
        self,
        status: int,
        code: str,
        field: str | None = None,
        headers: Mapping[str, str] | None = None,
    ) -> None:
        super().__init__(code)
        self.status = status
        self.code = code
        self.field = field
        self.headers = dict(headers or {})


def error_response(
    status: int,
    code: str,
    field: str | None = None,
    headers: Mapping[str, str] | None = None,
) -> Response:
    body = json.dumps(
        {"error": {"code": code, "message": MESSAGES[code], "field": field}},
        ensure_ascii=False,
    ).encode("utf-8")
    return Response(
        body,
        status_code=status,
        media_type="application/json",
        headers=dict(headers or {}),
    )


def response_for(error: ApiError) -> Response:
    return error_response(error.status, error.code, error.field, error.headers)


def unauthorized() -> ApiError:
    return ApiError(401, "unauthorized")


def forbidden() -> ApiError:
    return ApiError(403, "forbidden")


def entitlement_required() -> ApiError:
    return ApiError(403, "entitlement_required")


def not_found() -> ApiError:
    return ApiError(404, "not_found")


def conflict(field: str | None = None) -> ApiError:
    return ApiError(409, "conflict", field)


def invalid(field: str | None) -> ApiError:
    return ApiError(422, "validation_failed", field)


def rate_limited(retry_after: int) -> ApiError:
    return ApiError(429, "rate_limited", None, {"Retry-After": str(retry_after)})
