"""The single error shape every refused request goes through."""

from __future__ import annotations

from typing import Any

STATUS_FOR_CODE: dict[str, int] = {
    "unauthenticated": 401,
    "forbidden": 403,
    "not_found": 404,
    "method_not_allowed": 405,
    "validation": 400,
    "invalid_cursor": 400,
    "precondition_required": 428,
    "version_mismatch": 412,
    "payload_too_large": 413,
    "unsupported_media_type": 415,
    "service_unavailable": 503,
    "invalid_credentials": 401,
    "too_many_attempts": 429,
    "invite_used": 409,
    "invite_expired": 410,
    "invite_unusable": 409,
    "already_member": 409,
    "already_invited": 409,
    "last_admin": 409,
    "connector_not_installed": 422,
    "sample_events_unsupported": 422,
    "name_taken": 409,
    "table_conflict": 409,
    "frequency_exceeds_plan": 422,
    "sync_already_running": 409,
    "connection_inactive": 409,
    "job_not_active": 409,
    "idempotency_key_in_flight": 409,
    "idempotency_key_reused": 422,
    "source_http_error": 422,
    "stream_not_tested": 422,
}


class ApiError(Exception):
    """A refusal carrying its published code, headers and extra body fields."""

    def __init__(
        self,
        code: str,
        *,
        fields: dict[str, str] | None = None,
        headers: dict[str, str] | None = None,
        extra: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(code)
        self.code = code
        self.status = STATUS_FOR_CODE[code]
        self.fields = fields
        self.headers = headers or {}
        self.extra = extra or {}

    def body(self, request_id: str) -> dict[str, Any]:
        payload: dict[str, Any] = {"error": self.code}
        if self.fields is not None:
            payload["fields"] = self.fields
        payload.update(self.extra)
        payload["request_id"] = request_id
        return payload


def validation_error(fields: dict[str, str]) -> ApiError:
    return ApiError("validation", fields=fields)


UNKNOWN_FIELD_MESSAGE = "This field is not accepted here."
