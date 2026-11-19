"""Shared API error envelope (DP-79) and every HTTP error the app raises."""
from __future__ import annotations

import json
from typing import Optional

ERROR_MESSAGES = {
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

STATUS_FOR_CODE = {
    "unauthorized": 401,
    "invalid_credentials": 401,
    "payment_declined": 402,
    "forbidden": 403,
    "entitlement_required": 403,
    "not_found": 404,
    "method_not_allowed": 405,
    "conflict": 409,
    "payload_too_large": 413,
    "unsupported_media_type": 415,
    "range_not_satisfiable": 416,
    "validation_failed": 422,
    "rate_limited": 429,
}


class ApiError(Exception):
    """One shared helper builds every refused request's body."""

    def __init__(self, code: str, status: Optional[int] = None, field: Optional[str] = None,
                 headers: Optional[dict] = None) -> None:
        self.code = code
        self.status = status if status is not None else STATUS_FOR_CODE[code]
        self.field = field
        self.headers = headers or {}
        super().__init__(code)

    def body(self) -> dict:
        return {
            "error": {
                "code": self.code,
                "message": ERROR_MESSAGES[self.code],
                "field": self.field,
            }
        }

    def response_headers(self) -> dict:
        return dict(self.headers)


def unauthorized(field: Optional[str] = None) -> ApiError:
    return ApiError("unauthorized", field=field)


def forbidden() -> ApiError:
    return ApiError("forbidden")


def not_found() -> ApiError:
    return ApiError("not_found")


def validation(field: Optional[str] = None) -> ApiError:
    return ApiError("validation_failed", field=field)


def conflict(field: Optional[str] = None) -> ApiError:
    return ApiError("conflict", field=field)


def rate_limited(retry_after: int) -> ApiError:
    return ApiError("rate_limited", headers={"Retry-After": str(max(1, int(retry_after)))})


def method_not_allowed(allowed: list) -> ApiError:
    ordered = [m for m in ("GET", "POST", "PUT", "PATCH", "DELETE") if m in allowed]
    return ApiError("method_not_allowed", headers={"Allow": ", ".join(ordered)})


def dumps(obj) -> bytes:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
