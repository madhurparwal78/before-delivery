"""The one place that builds a refusal: fixed status, code and message, never anything else."""

from __future__ import annotations

from flask import Response, jsonify

REFUSALS: dict[str, tuple[int, str]] = {
    "unauthorized": (401, "Sign in to continue."),
    "invalid_credentials": (401, "That email and password do not match."),
    "payment_declined": (402, "Your card was declined."),
    "forbidden": (403, "You do not have permission to do that."),
    "entitlement_required": (403, "Your membership tier does not include this."),
    "not_found": (404, "Not found."),
    "method_not_allowed": (405, "Method not allowed."),
    "conflict": (409, "That conflicts with the current state."),
    "payload_too_large": (413, "That is too large."),
    "unsupported_media_type": (415, "That content type is not supported."),
    "range_not_satisfiable": (416, "That range is not satisfiable."),
    "validation_failed": (422, "Check the named field."),
    "rate_limited": (429, "Too many requests. Try again later."),
    "server_error": (500, "Something went wrong."),
}


class ApiError(Exception):
    """Raise anywhere inside a request; the pipeline turns it into the shared error body."""

    def __init__(self, code: str, field: str | None = None, headers: dict[str, str] | None = None):
        super().__init__(code)
        self.code = code
        self.field = field
        self.headers = headers or {}

    @property
    def status(self) -> int:
        return REFUSALS[self.code][0]


def refusal_response(error: ApiError) -> Response:
    status, message = REFUSALS[error.code]
    response = jsonify({"error": {"code": error.code, "message": message, "field": error.field}})
    response.status_code = status
    for name, value in error.headers.items():
        response.headers[name] = value
    return response


def invalid(field: str | None) -> ApiError:
    return ApiError("validation_failed", field)


def retry_after(seconds: int) -> dict[str, str]:
    return {"Retry-After": str(max(1, int(seconds)))}
