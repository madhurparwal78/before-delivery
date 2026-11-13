"""The one published error shape and the API error codes.

Every API error is produced here; no route builds its own error body.
"""

from __future__ import annotations

import json
from typing import Any, Mapping

from aiohttp import web


class ApiError(Exception):
    """An API error with the published body, status, code, message and field errors."""

    __slots__ = ("status", "code", "message", "fields")

    def __init__(
        self,
        status: int,
        code: str,
        message: str,
        fields: Mapping[str, str] | None = None,
        headers: Mapping[str, str] | None = None,
        headers_dict: dict[str, str] | None = None,
    ) -> None:
        super().__init__(f"{status} {code}: {message}")
        self.status = status
        self.code = code
        self.message = message
        self.fields: dict[str, str] = dict(fields or {})

    def body(self) -> dict[str, Any]:
        error: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.fields:
            error["fields"] = self.fields
        return {"error": error}

    def json_bytes(self) -> bytes:
        return json.dumps(
            {"error": self.body()["error"]}, ensure_ascii=False, separators=(",", ":")
        ).encode("utf-8")


def json_response(data: Any, status: int = 200) -> web.Response:
    body = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return web.Response(
        status=status,
        body=body,
        content_type="application/json",
        charset="utf-8",
    )


def error_response(err: ApiError) -> web.Response:
    return web.Response(
        status=err.status,
        body=err.json_bytes(),
        content_type="application/json",
        charset="utf-8",
    )


# --- Field messages ----------------------------------------------------------

MSG_REQUIRED = "Required."
MSG_TOO_LONG = "Too long."
MSG_CHOOSE_KIND = "Choose a data kind from the list."
MSG_CHOOSE_LEVEL = "Choose a level from the list."
MSG_DATE_FORM = "Use a date in the form YYYY-MM-DD."
MSG_DATE_FUTURE = "Date cannot be in the future."
MSG_TICK_KIND = "Tick at least one data kind."
MSG_KIND_ONCE = "Each data kind can appear once."
MSG_PRIORITY = "Priority must be a whole number from 1 to 999."
MSG_RULE_LIST = "List every rule exactly once."
MSG_SEND_VERSION = "Send the version you loaded."
MSG_EMAIL = "Enter an email address."
MSG_CONTACT_EMAIL = "This email cannot be used for a trusted contact."
MSG_DURATION = "Choose 24h, 7d or 30d."
MSG_AT_LEAST_ONE_LEVEL = "Choose at least one level."
MSG_NARROW_ONLY = "Scope can only be narrowed. Revoke and grant again to widen it."
MSG_CANNOT_SET = "This field cannot be set."
MSG_CURRENT_PASSWORD = "Current password is incorrect."
MSG_PASSWORD_LENGTH = "Use 12 to 128 characters."
MSG_PASSWORD_DIFFERENT = "New password must differ from the current one."


# --- Error constructors ------------------------------------------------------


def signed_out() -> ApiError:
    return ApiError(401, "signed_out", "Sign in to continue.")


def cross_origin() -> ApiError:
    return ApiError(403, "cross_origin", "Request refused.")


def access_ended() -> ApiError:
    return ApiError(403, "access_ended", "This shared view has ended.")


def owner_only() -> ApiError:
    return ApiError(403, "owner_only", "Only the vault owner can do this.")


def not_found() -> ApiError:
    return ApiError(404, "not_found", "Not found.")


def holding_exists() -> ApiError:
    return ApiError(409, "holding_exists", "This company already holds that data kind in your ledger.")


def rule_limit() -> ApiError:
    return ApiError(409, "rule_limit", "A vault holds at most 50 rules.")


def stale_version() -> ApiError:
    return ApiError(409, "stale_version", "This record changed in another window. Reload it and try again.")


def step_already_done() -> ApiError:
    return ApiError(409, "step_already_done", "This step is already done.")


def step_already_open() -> ApiError:
    return ApiError(409, "step_already_open", "This step is already open.")


def step_out_of_order() -> ApiError:
    return ApiError(409, "step_out_of_order", "Finish the step before this one first.")


def grant_active() -> ApiError:
    return ApiError(409, "grant_active", "A trusted contact already has access. Revoke it first.")


def no_active_grant() -> ApiError:
    return ApiError(409, "no_active_grant", "There is no active grant.")


def idempotency_conflict() -> ApiError:
    return ApiError(409, "idempotency_conflict", "This Idempotency-Key was used with a different request.")


def too_large() -> ApiError:
    return ApiError(413, "too_large", "Request body is too large.")


def unsupported_media_type() -> ApiError:
    return ApiError(415, "unsupported_media_type", "Send JSON.")


def validation(fields: Mapping[str, str]) -> ApiError:
    return ApiError(422, "validation", "Check the highlighted fields.", fields=fields)


def internal_error() -> ApiError:
    return ApiError(500, "internal", "Something went wrong.")


def identity_unavailable() -> ApiError:
    return ApiError(503, "identity_unavailable", "Sign-in service unavailable. Try again in a few minutes.")
