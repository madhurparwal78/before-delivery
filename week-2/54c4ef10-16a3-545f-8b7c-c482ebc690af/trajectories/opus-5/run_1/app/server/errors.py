"""The one error shape every refusal takes."""

from __future__ import annotations

from typing import Any


class ApiError(Exception):
    """An error answered as {"error": code} with its published extras."""

    def __init__(
        self, status: int, code: str, extra: dict[str, Any] | None = None
    ) -> None:
        super().__init__(code)
        self.status = status
        self.code = code
        self.extra = extra or {}

    def body(self) -> dict[str, Any]:
        return {"error": self.code, **self.extra}


def cross_origin() -> ApiError:
    return ApiError(403, "cross_origin")


def unauthenticated() -> ApiError:
    return ApiError(401, "unauthenticated")


def not_found() -> ApiError:
    return ApiError(404, "not_found")


def stale_alignment(version: int) -> ApiError:
    return ApiError(412, "stale_alignment", {"version": version})


def too_large() -> ApiError:
    return ApiError(413, "too_large")


def unsupported_media_type() -> ApiError:
    return ApiError(415, "unsupported_media_type")


def unsupported_format() -> ApiError:
    return ApiError(415, "unsupported_format")


def conflict(code: str, extra: dict[str, Any] | None = None) -> ApiError:
    return ApiError(409, code, extra)


def validation_failed(fields: dict[str, str]) -> ApiError:
    return ApiError(422, "validation_failed", {"fields": fields})


def storage_unavailable() -> ApiError:
    return ApiError(503, "storage_unavailable")
