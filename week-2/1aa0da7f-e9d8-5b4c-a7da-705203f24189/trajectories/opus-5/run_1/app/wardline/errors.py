"""The one error shape for the whole API, following the published catalogue."""

from __future__ import annotations

from typing import Any

# code -> status
STATUS: dict[str, int] = {
    "unauthenticated": 401,
    "sign_in_failed": 401,
    "sign_in_locked": 429,
    "not_found": 404,
    "forbidden": 403,
    "forbidden_origin": 403,
    "separation_of_duties": 403,
    "step_up_required": 403,
    "step_up_failed": 403,
    "illegal_transition": 409,
    "stale_access_list": 409,
    "last_case_lead": 409,
    "stale_marks": 409,
    "grant_exists": 409,
    "grant_not_active": 409,
    "exhibit_not_cleared": 409,
    "seal_mismatch": 409,
    "release_empty": 409,
    "release_locked": 409,
    "release_changed": 409,
    "derivative_superseded": 409,
    "items_unopened": 409,
    "not_previewable": 409,
    "not_redactable": 409,
    "legal_hold": 409,
    "hold_exists": 409,
    "exhibit_in_release": 409,
    "already_granted": 409,
    "break_glass_active": 409,
    "derivative_missing": 409,
    "idempotency_conflict": 409,
    "method_not_allowed": 405,
    "body_too_large": 413,
    "file_too_large": 413,
    "unsupported_media_type": 415,
    "throttled": 429,
    "storage_unavailable": 503,
    "service_unavailable": 503,
}

DENIAL_CODES = frozenset(
    {"not_found", "forbidden", "separation_of_duties", "step_up_required"}
)


class ApiError(Exception):
    """Any refused request. `target` names the id that caused a denial."""

    def __init__(
        self,
        code: str,
        *,
        extra: dict[str, Any] | None = None,
        target: str | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(code)
        self.code = code
        self.status = STATUS[code]
        self.extra = extra or {}
        self.target = target
        self.headers = headers or {}

    @property
    def body(self) -> dict[str, Any]:
        return {"error": self.code, **self.extra}


class ValidationFailed(Exception):
    """A 422 naming every refused field."""

    def __init__(self, fields: dict[str, str]) -> None:
        super().__init__("validation")
        self.code = "validation"
        self.status = 422
        self.fields = dict(fields)
        self.headers: dict[str, str] = {}
        self.target = None

    @property
    def body(self) -> dict[str, Any]:
        return {"errors": self.fields}


def file_too_large() -> ApiError:
    return ApiError("file_too_large", extra={"max_bytes": 20000000})


def illegal_transition(from_state: str, to_state: str) -> ApiError:
    return ApiError(
        "illegal_transition", extra={"from": from_state, "to": to_state}
    )
