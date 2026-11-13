"""One error shape for every API answer."""
from __future__ import annotations

from typing import Any

from starlette.responses import JSONResponse

MESSAGES: dict[str, str] = {
    "signed_out": "Sign in to continue.",
    "cross_origin": "Request refused.",
    "access_ended": "This shared view has ended.",
    "owner_only": "Only the vault owner can do this.",
    "not_found": "Not found.",
    "holding_exists": "This company already holds that data kind in your ledger.",
    "rule_limit": "A vault holds at most 50 rules.",
    "stale_version": "This record changed in another window. Reload it and try again.",
    "step_already_done": "This step is already done.",
    "step_already_open": "This step is already open.",
    "step_out_of_order": "Finish the step before this one first.",
    "grant_active": "A trusted contact already has access. Revoke it first.",
    "no_active_grant": "There is no active grant.",
    "idempotency_conflict": "This Idempotency-Key was used with a different request.",
    "too_large": "Request body is too large.",
    "unsupported_media_type": "Send JSON.",
    "validation": "Check the highlighted fields.",
    "internal": "Something went wrong.",
    "identity_unavailable": "Sign-in service unavailable. Try again in a few minutes.",
}

STATUS: dict[str, int] = {
    "signed_out": 401, "cross_origin": 403, "access_ended": 403, "owner_only": 403, "not_found": 404,
    "holding_exists": 409, "rule_limit": 409, "stale_version": 409, "step_already_done": 409,
    "step_already_open": 409, "step_out_of_order": 409, "grant_active": 409, "no_active_grant": 409,
    "idempotency_conflict": 409, "too_large": 413, "unsupported_media_type": 415, "validation": 422,
    "internal": 500, "identity_unavailable": 503,
}


class ApiError(Exception):
    def __init__(self, code: str, fields: dict[str, str] | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.fields = fields


def error_response(error: ApiError) -> JSONResponse:
    body: dict[str, Any] = {"code": error.code, "message": MESSAGES[error.code]}
    if error.fields is not None:
        body["fields"] = error.fields
    return JSONResponse({"error": body}, status_code=STATUS[error.code])
