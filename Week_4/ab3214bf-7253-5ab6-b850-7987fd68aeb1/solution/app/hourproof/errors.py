"""Every API error has one shape, and carries only published copy."""

from __future__ import annotations

from .jsontypes import JsonObject

MESSAGES = {
    "BODY_TOO_LARGE": "That request is too large.",
    "UNAUTHENTICATED": "Sign in first.",
    "INVALID_CREDENTIALS": "That email and password don't match — try again.",
    "NOT_FOUND": "That page does not exist.",
    "FORBIDDEN": "Your role cannot do that.",
    "VALIDATION": "Fix the highlighted fields.",
    "METER_HUB_UNAVAILABLE": "METER HUB IS DOWN. NO READINGS CHANGED.",
    "REGISTRY_UNAVAILABLE": "REGISTRY IS DOWN. NOTHING WAS CANCELLED.",
    "STORE_UNAVAILABLE": "THE STORE IS DOWN. TRY THIS CHECK AGAIN.",
    "HOUR_IS_ACTUAL": "This hour has an Actual reading.",
    "HOUR_NOT_SPREADABLE": "Only Missing or Estimated hours can take a spread.",
    "NO_VERIFIER": "Assign a verifier firm first.",
    "LOT_EXPIRED": "A lot passed its cancel-by time — back to reconciling.",
    "INTERNAL": "Something went wrong. Try again.",
}

STATUS = {
    "BODY_TOO_LARGE": 413,
    "UNAUTHENTICATED": 401,
    "INVALID_CREDENTIALS": 401,
    "NOT_FOUND": 404,
    "FORBIDDEN": 403,
    "VALIDATION": 422,
    "NOT_WHOLE_WATT_HOUR": 422,
    "CONFLICTING_CORRECTION": 422,
    "WRONG_STATE": 409,
    "STALE_REVISION": 409,
    "WINDOW_NOT_OPEN": 409,
    "HOUR_IS_ACTUAL": 409,
    "HOUR_NOT_SPREADABLE": 409,
    "HOURS_MISSING": 409,
    "NO_VERIFIER": 409,
    "SAMPLE_INCOMPLETE": 409,
    "LOT_EXPIRED": 409,
    "METER_HUB_UNAVAILABLE": 503,
    "REGISTRY_UNAVAILABLE": 503,
    "STORE_UNAVAILABLE": 503,
    "INTERNAL": 500,
}

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
    "firm_id": "Choose a verifier firm.",
    "email": "Enter your email.",
    "password": "Enter your password.",
}


class ApiError(Exception):
    def __init__(
        self,
        code: str,
        message: str | None = None,
        *,
        fields: dict[str, str] | None = None,
        extra: JsonObject | None = None,
    ) -> None:
        super().__init__(code)
        self.code = code
        self.status = STATUS[code]
        self.message = message if message is not None else MESSAGES[code]
        self.fields = fields
        self.extra = extra or {}

    def body(self) -> JsonObject:
        error: JsonObject = {"code": self.code, "message": self.message}
        if self.status == 422:
            error["fields"] = self.fields or {}
        error.update(self.extra)
        return {"error": error}


def validation(*names: str) -> ApiError:
    return ApiError("VALIDATION", fields={name: FIELD_MESSAGES[name] for name in names})


def wrong_state(state: str) -> ApiError:
    return ApiError("WRONG_STATE", f"This window is {state}. That can't be done now.")
