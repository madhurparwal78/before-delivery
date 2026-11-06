"""The error catalogue: every refusal in the API goes through ApiError."""

from __future__ import annotations

from typing import Any

STATUS = {
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



class ApiError(Exception):
    """A published refusal. `denial_target` set means it writes one access.denied entry."""

    def __init__(
        self,
        code: str,
        *,
        denial_target: str | None = None,
        retry_after: int | None = None,
        **fields: Any,
    ) -> None:
        super().__init__(code)
        self.code = code
        self.status = STATUS[code]
        self.body = {"error": code, **fields}
        self.denial_target = denial_target
        self.retry_after = retry_after


class ValidationFailed(Exception):
    """A 422: every refused field with its copy."""

    def __init__(self, errors: dict[str, str]) -> None:
        super().__init__("validation")
        self.errors = errors


class StorageUnavailable(Exception):
    """MinIO could not be reached or refused the credentials."""


class ClientGone(Exception):
    """The client closed the connection before the request finished."""


def illegal(from_state: str, to_state: str) -> ApiError:
    return ApiError("illegal_transition", **{"from": from_state, "to": to_state})
