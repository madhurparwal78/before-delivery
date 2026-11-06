"""The single error shape used by every API answer."""

from __future__ import annotations

from typing import Any

from .web import Response, json_response

VALIDATION_MESSAGE = "Please correct the fields below."


def error(
    http_status: int,
    code: str,
    *,
    headers: list[tuple[str, str]] | None = None,
    **extra: Any,
) -> Response:
    payload: dict[str, Any] = {"error": code}
    payload.update(extra)
    return json_response(http_status, payload, headers=headers)


def validation_payload(
    errors: dict[str, str],
    values: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "error": "validation_failed",
        "message": VALIDATION_MESSAGE,
        "errors": errors,
    }
    if values is not None:
        payload["values"] = values
    return payload


def validation_error(
    errors: dict[str, str],
    values: dict[str, Any] | None = None,
) -> Response:
    return json_response(422, validation_payload(errors, values))


def unauthorized() -> Response:
    return error(401, "unauthorized", headers=[("WWW-Authenticate", "Bearer")])


def forbidden() -> Response:
    return error(403, "forbidden")


def not_found() -> Response:
    return error(404, "not_found")


def method_not_allowed(allowed: list[str]) -> Response:
    return error(405, "method_not_allowed", headers=[("Allow", ", ".join(allowed))])


def auth_unavailable() -> Response:
    return error(503, "auth_unavailable")


def service_unavailable() -> Response:
    return error(503, "service_unavailable")


def internal_error() -> Response:
    return error(500, "internal_error")
