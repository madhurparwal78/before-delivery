"""The one error shape for the whole API (error catalogue)."""
from __future__ import annotations

from typing import Any

from starlette.responses import JSONResponse


class ApiError(Exception):
    def __init__(self, status: int, body: dict, headers: dict[str, str] | None = None):
        super().__init__(str(body.get("error")))
        self.status = status
        self.body = body
        self.headers = headers or {}


def unauthenticated() -> ApiError:
    return ApiError(401, {"error": "unauthenticated"})


def sign_in_failed() -> ApiError:
    return ApiError(401, {"error": "sign_in_failed"})


def sign_in_locked(retry_after: int) -> ApiError:
    return ApiError(429, {"error": "sign_in_locked"}, {"Retry-After": str(retry_after)})


def not_found() -> ApiError:
    return ApiError(404, {"error": "not_found"})


def forbidden() -> ApiError:
    return ApiError(403, {"error": "forbidden"})


def forbidden_origin() -> ApiError:
    return ApiError(403, {"error": "forbidden_origin"})


def separation_of_duties() -> ApiError:
    return ApiError(403, {"error": "separation_of_duties"})


def step_up_required() -> ApiError:
    return ApiError(403, {"error": "step_up_required"})


def step_up_failed() -> ApiError:
    return ApiError(403, {"error": "step_up_failed"})


def illegal_transition(from_state: str, to_state: str) -> ApiError:
    return ApiError(409, {"error": "illegal_transition", "from": from_state, "to": to_state})


def stale_access_list(version: int) -> ApiError:
    return ApiError(409, {"error": "stale_access_list", "access_version": version})


def last_case_lead() -> ApiError:
    return ApiError(409, {"error": "last_case_lead"})


def stale_marks(version: int) -> ApiError:
    return ApiError(409, {"error": "stale_marks", "marks_version": version})


def grant_exists() -> ApiError:
    return ApiError(409, {"error": "grant_exists"})


def grant_not_active() -> ApiError:
    return ApiError(409, {"error": "grant_not_active"})


def exhibit_not_cleared(state: str) -> ApiError:
    return ApiError(409, {"error": "exhibit_not_cleared", "state": state})


def seal_mismatch(sha256: str) -> ApiError:
    return ApiError(409, {"error": "seal_mismatch", "sha256": sha256})


def release_empty() -> ApiError:
    return ApiError(409, {"error": "release_empty"})


def release_locked(state: str) -> ApiError:
    return ApiError(409, {"error": "release_locked", "state": state})


def release_changed(manifest_digest: str) -> ApiError:
    return ApiError(409, {"error": "release_changed", "manifest_digest": manifest_digest})


def derivative_superseded(derivative_id: str) -> ApiError:
    return ApiError(409, {"error": "derivative_superseded", "derivative_id": derivative_id})


def items_unopened(item_ids: list[str]) -> ApiError:
    return ApiError(409, {"error": "items_unopened", "item_ids": item_ids})


def not_previewable() -> ApiError:
    return ApiError(409, {"error": "not_previewable"})


def not_redactable() -> ApiError:
    return ApiError(409, {"error": "not_redactable"})


def legal_hold() -> ApiError:
    return ApiError(409, {"error": "legal_hold"})


def hold_exists() -> ApiError:
    return ApiError(409, {"error": "hold_exists"})


def exhibit_in_release() -> ApiError:
    return ApiError(409, {"error": "exhibit_in_release"})


def already_granted() -> ApiError:
    return ApiError(409, {"error": "already_granted"})


def break_glass_active() -> ApiError:
    return ApiError(409, {"error": "break_glass_active"})


def derivative_missing() -> ApiError:
    return ApiError(409, {"error": "derivative_missing"})


def idempotency_conflict() -> ApiError:
    return ApiError(409, {"error": "idempotency_conflict"})


def method_not_allowed() -> ApiError:
    return ApiError(405, {"error": "method_not_allowed"})


def body_too_large() -> ApiError:
    return ApiError(413, {"error": "body_too_large"})


def file_too_large() -> ApiError:
    return ApiError(413, {"error": "file_too_large", "max_bytes": 20000000})


def unsupported_media_type() -> ApiError:
    return ApiError(415, {"error": "unsupported_media_type"})


def validation(errors: dict[str, str]) -> ApiError:
    return ApiError(422, {"errors": errors})


def throttled(retry_after: int) -> ApiError:
    return ApiError(429, {"error": "throttled"}, {"Retry-After": str(retry_after)})


def storage_unavailable() -> ApiError:
    return ApiError(503, {"error": "storage_unavailable"})


def service_unavailable() -> ApiError:
    return ApiError(503, {"error": "service_unavailable"})


REQUIRED = "This field is required."


def over_length(maximum: int) -> str:
    return f"Keep this to {maximum} characters or fewer."


UNSTORABLE = "This field holds characters that cannot be stored."
BODY_UNREADABLE = "This request could not be read."
IDEMPOTENCY_BAD = "This key cannot be used."
DATE_COPY = "Enter a date that is not in the future, as YYYY-MM-DD."
PAGE_COPY = "Choose a page of this exhibit."


def reason_copy(minimum: int) -> str:
    return f"Write a reason of at least {minimum} characters."


REGIONS_COPY = "Each region must sit inside its page."
FUTURE_TIME_COPY = "Choose a time in the future."
NINETY_DAY_COPY = "Choose a time within 90 days."


def to_response(err: ApiError) -> JSONResponse:
    headers = dict(err.headers)
    headers["X-Content-Type-Options"] = "nosniff"
    return JSONResponse(err.body, status_code=err.status, headers=headers)
