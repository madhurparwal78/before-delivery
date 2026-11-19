"""The one API error shape and the published refusal copy."""

from __future__ import annotations

from typing import Any

FIELD_MESSAGES = {
    "value_wh": "Enter a whole number of watt-hours.",
    "total_wh": "Enter a whole number of watt-hours.",
    "reason": "Enter a reason of 1 to 500 characters.",
    "note": "Enter a note of 1 to 2,000 characters.",
    "hours": "Select 2 to 168 consecutive hours.",
    "target_bp": "Enter a percent from 0.00 to 100.00 with at most two decimals.",
    "target_grain": "Choose MONTH, WEEK, DAY or HOUR.",
    "lot_ids": "Send every lot exactly once.",
    "result": "Choose agree or exception.",
    "excluded": "Send true or false.",
    "revision": "Send the window's revision as a whole number.",
    "typed_name": "Type your name exactly as it appears on your account.",
}

REVIEW_TIMEOUT_COPY = "REVIEW TIME RAN OUT. SENT BACK TO THE ANALYST."

HELD_PRESS_COPY = "PDF PRESS IS DOWN. YOUR SIGNATURE IS SAFE."
HELD_STORE_COPY = "THE STORE IS DOWN. YOUR SIGNATURE IS SAFE."


class ApiError(Exception):
    """Every refusal the API publishes."""

    def __init__(
        self,
        status: int,
        code: str,
        message: str,
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
        if self.fields is not None:
            error["fields"] = self.fields
        error.update(self.extra)
        return {"error": error}


def body_too_large() -> ApiError:
    return ApiError(413, "BODY_TOO_LARGE", "That request body is too large.")


def unauthenticated() -> ApiError:
    return ApiError(401, "UNAUTHENTICATED", "Your session ended. Sign in to finish.")


def invalid_credentials() -> ApiError:
    return ApiError(
        401, "INVALID_CREDENTIALS", "That email and password don't match — try again."
    )


def not_found() -> ApiError:
    return ApiError(404, "NOT_FOUND", "THAT PAGE DOES NOT EXIST.")


def forbidden() -> ApiError:
    return ApiError(403, "FORBIDDEN", "Your role cannot do that.")


def validation(fields: dict[str, str]) -> ApiError:
    return ApiError(422, "VALIDATION", "Fix the fields and try again.", fields=fields)


def field_error(field: str) -> ApiError:
    return validation({field: FIELD_MESSAGES[field]})


def wrong_state(state: str) -> ApiError:
    return ApiError(409, "WRONG_STATE", f"This window is {state}. That can't be done now.")


def stale_revision(writer_name: str, wrote_at: str) -> ApiError:
    clock = wrote_at[11:16]
    return ApiError(
        409,
        "STALE_REVISION",
        f"{writer_name} changed this window at {clock} UTC. Your change was not saved.",
        extra={"wrote_by": writer_name, "wrote_at": wrote_at},
    )


def hours_missing(count: int) -> ApiError:
    return ApiError(409, "HOURS_MISSING", f"{count} hours are still Missing. Fix them first.")


def window_not_open(opens_at: str) -> ApiError:
    return ApiError(409, "WINDOW_NOT_OPEN", f"This window opens at {opens_at}.")


def not_whole_watt_hour(line_number: int) -> ApiError:
    return ApiError(
        422, "NOT_WHOLE_WATT_HOUR", f"Line {line_number} is not a whole watt-hour."
    )


def conflicting_correction(line_number: int) -> ApiError:
    return ApiError(
        422, "CONFLICTING_CORRECTION", f"Line {line_number} conflicts with an earlier line."
    )


def sample_incomplete(count: int) -> ApiError:
    return ApiError(409, "SAMPLE_INCOMPLETE", f"{count} sampled hours still need a result.")


def no_verifier() -> ApiError:
    return ApiError(409, "NO_VERIFIER", "Assign a verifier firm first.")


def lot_expired() -> ApiError:
    return ApiError(
        409, "LOT_EXPIRED", "A lot passed its cancel-by time — back to reconciling."
    )


def hour_is_actual() -> ApiError:
    return ApiError(409, "HOUR_IS_ACTUAL", "This hour has an Actual reading.")


def hour_not_spreadable() -> ApiError:
    return ApiError(
        409, "HOUR_NOT_SPREADABLE", "Only Missing or Estimated hours can take a spread."
    )


def registry_unavailable() -> ApiError:
    return ApiError(
        503, "REGISTRY_UNAVAILABLE", "REGISTRY IS DOWN. NOTHING WAS CANCELLED."
    )


def registry_unavailable_holdings() -> ApiError:
    return ApiError(
        503, "REGISTRY_UNAVAILABLE", "REGISTRY IS DOWN. HOLDINGS ARE UNCHANGED."
    )


def meter_hub_unavailable() -> ApiError:
    return ApiError(
        503, "METER_HUB_UNAVAILABLE", "METER HUB IS DOWN. NO READINGS CHANGED."
    )


def store_unavailable() -> ApiError:
    return ApiError(503, "STORE_UNAVAILABLE", "THE STORE IS DOWN. TRY THIS CHECK AGAIN.")
