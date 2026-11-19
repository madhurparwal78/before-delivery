"""The one error shape used by every service and the public API."""

from __future__ import annotations

from typing import Any

from .config import SERVICE_LABELS


class ApiError(Exception):
    """An error that renders as the published error body."""

    def __init__(
        self,
        status: int,
        code: str,
        message: str,
        *,
        fields: dict[str, str] | None = None,
        extra: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.fields = fields
        self.extra = extra or {}

    def body(self) -> dict[str, Any]:
        error: dict[str, Any] = {"code": self.code, "message": self.message}
        error.update(self.extra)
        payload: dict[str, Any] = {"error": error}
        if self.fields is not None:
            payload["fields"] = self.fields
        return payload


def too_large(message: str) -> ApiError:
    return ApiError(413, "too_large", message)


def unsupported_media_type(message: str) -> ApiError:
    return ApiError(415, "unsupported_media_type", message)


def unauthenticated() -> ApiError:
    return ApiError(401, "unauthenticated", "Unlock your workspace first.")


def not_found() -> ApiError:
    return ApiError(404, "not_found", "That record does not exist.")


def conflict(code: str, message: str) -> ApiError:
    return ApiError(409, code, message)


def validation(fields: dict[str, str]) -> ApiError:
    return ApiError(
        422, "validation", "Check the highlighted fields.", fields=fields
    )


def service_unavailable(service: str) -> ApiError:
    label = SERVICE_LABELS[service]
    return ApiError(
        503,
        "service_unavailable",
        f"{label} is not answering. Try again in a moment.",
    )


def storage_unavailable(message: str) -> ApiError:
    return ApiError(503, "storage_unavailable", message)
