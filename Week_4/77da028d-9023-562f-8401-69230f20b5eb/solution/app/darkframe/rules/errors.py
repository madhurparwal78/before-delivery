"""The one error body: {"error": {"code", "message"}} plus "fields" on a 422."""
from typing import Any

PRECEDENCE_MESSAGES = {
    "unauthenticated": "Unlock your workspace first.",
    "not_found": "That record was not found.",
    "too_large": "The request body is too large.",
    "unsupported_media_type": "That content type is not supported here.",
}


class ApiFault(Exception):
    """A refusal with the status, code and message the brief names."""

    def __init__(self, status: int, code: str, message: str, fields: dict[str, str] | None = None,
                 extra: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.fields = fields
        self.extra = extra or {}

    def body(self) -> dict[str, Any]:
        error: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.fields is not None:
            error["fields"] = self.fields
        error.update(self.extra)
        return {"error": error}


def not_found() -> ApiFault:
    return ApiFault(404, "not_found", PRECEDENCE_MESSAGES["not_found"])


def conflict(code: str, message: str) -> ApiFault:
    return ApiFault(409, code, message)


def validation(fields: dict[str, str]) -> ApiFault:
    return ApiFault(422, "validation", "Check the highlighted fields.", fields)


def service_unavailable(service_label: str) -> ApiFault:
    return ApiFault(503, "service_unavailable", f"{service_label} is not answering. Try again in a moment.")
