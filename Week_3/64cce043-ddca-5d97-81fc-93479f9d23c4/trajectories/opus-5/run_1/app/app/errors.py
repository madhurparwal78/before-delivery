"""The one published error shape."""
from __future__ import annotations

import json
from typing import Final

from starlette.responses import Response

JSON_CONTENT_TYPE: Final = "application/json; charset=utf-8"

ERRORS: Final[dict[str, tuple[int, str]]] = {
    "signed_out": (401, "Sign in to continue."),
    "cross_origin": (403, "Request refused."),
    "access_ended": (403, "This shared view has ended."),
    "owner_only": (403, "Only the vault owner can do this."),
    "not_found": (404, "Not found."),
    "holding_exists": (409, "This company already holds that data kind in your ledger."),
    "rule_limit": (409, "A vault holds at most 50 rules."),
    "stale_version": (409, "This record changed in another window. Reload it and try again."),
    "step_already_done": (409, "This step is already done."),
    "step_already_open": (409, "This step is already open."),
    "step_out_of_order": (409, "Finish the step before this one first."),
    "grant_active": (409, "A trusted contact already has access. Revoke it first."),
    "no_active_grant": (409, "There is no active grant."),
    "idempotency_conflict": (409, "This Idempotency-Key was used with a different request."),
    "too_large": (413, "Request body is too large."),
    "unsupported_media_type": (415, "Send JSON."),
    "validation": (422, "Check the highlighted fields."),
    "internal": (500, "Something went wrong."),
    "identity_unavailable": (503, "Sign-in service unavailable. Try again in a few minutes."),
}

FIELD_REQUIRED: Final = "Required."
FIELD_TOO_LONG: Final = "Too long."
FIELD_UNKNOWN_KIND: Final = "Choose a data kind from the list."
FIELD_UNKNOWN_LEVEL: Final = "Choose a level from the list."
FIELD_BAD_DATE: Final = "Use a date in the form YYYY-MM-DD."
FIELD_FUTURE_DATE: Final = "Date cannot be in the future."
FIELD_KINDS_EMPTY: Final = "Tick at least one data kind."
FIELD_KIND_REPEATED: Final = "Each data kind can appear once."
FIELD_BAD_PRIORITY: Final = "Priority must be a whole number from 1 to 999."
FIELD_RULE_IDS: Final = "List every rule exactly once."
FIELD_VERSION: Final = "Send the version you loaded."
FIELD_BAD_EMAIL: Final = "Enter an email address."
FIELD_EMAIL_TAKEN: Final = "This email cannot be used for a trusted contact."
FIELD_BAD_DURATION: Final = "Choose 24h, 7d or 30d."
FIELD_LEVELS_EMPTY: Final = "Choose at least one level."
FIELD_WIDENING: Final = "Scope can only be narrowed. Revoke and grant again to widen it."
FIELD_NOT_SETTABLE: Final = "This field cannot be set."
FIELD_WRONG_PASSWORD: Final = "Current password is incorrect."
FIELD_PASSWORD_LENGTH: Final = "Use 12 to 128 characters."
FIELD_PASSWORD_SAME: Final = "New password must differ from the current one."


class ApiError(Exception):
    """Raised anywhere a request cannot be answered; rendered as the published body."""

    def __init__(self, code: str, fields: dict[str, str] | None = None) -> None:
        status, message = ERRORS[code]
        super().__init__(message)
        self.code = code
        self.status = status
        self.message = message
        self.fields = fields

    def body(self) -> dict[str, object]:
        error: dict[str, object] = {"code": self.code, "message": self.message}
        if self.fields is not None:
            error["fields"] = self.fields
        return {"error": error}

    def response(self) -> Response:
        return Response(
            json.dumps(self.body()),
            status_code=self.status,
            media_type=JSON_CONTENT_TYPE,
        )


def validation_error(fields: dict[str, str]) -> ApiError:
    return ApiError("validation", fields)


def json_response(payload: object, status_code: int = 200) -> Response:
    return Response(json.dumps(payload), status_code=status_code, media_type=JSON_CONTENT_TYPE)
