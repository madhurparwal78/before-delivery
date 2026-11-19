"""The single API error shape (brief: API, Error body)."""

MESSAGES = {
    "bad_credentials": "Username or passcode is wrong.",
    "unauthenticated": "Your session has ended. Sign in again.",
    "forbidden": "Your role cannot do this.",
    "not_holder": "Only the inspector who holds this work card can do this.",
    "out_of_scope": "Your certification scope does not cover this model.",
    "not_found": "Nothing exists at this address.",
    "method_not_allowed": "This method is not allowed here.",
    "idempotency_key_required": "This request needs an Idempotency-Key header.",
    "idempotency_key_invalid": "The Idempotency-Key must be 1 to 100 printable ASCII characters.",
    "idempotency_mismatch": "This Idempotency-Key was already used with a different request.",
    "invalid_transition": "This action is not possible from the thread's current stage.",
    "directive_withdrawn": "This directive is withdrawn.",
    "effectivity_unconfirmed": "Waiting for the planner to confirm effectivity.",
    "revision_changed": "This thread moved to another revision.",
    "card_held": "This work card is already held.",
    "past_due": "Too late to defer: the due instant has passed.",
    "already_deferred": "This thread was already deferred under its current revision.",
    "directive_exists": "This directive is already on the board.",
    "revision_out_of_order": "That revision is not the next one for this directive.",
    "not_contractor": "Only contractor records can be erased.",
    "already_erased": "This person was already erased.",
    "pack_already_queued": "A pack for this directive is already queued.",
    "pack_not_transmitted": "This pack has not been transmitted yet.",
    "payload_too_large": "The request body is larger than this endpoint accepts.",
    "unsupported_media_type": "The request body has the wrong content type.",
    "validation": "Some fields are not valid.",
    "storage_unavailable": "Object storage is unavailable.",
}

STATUS = {
    "idempotency_key_required": 400, "idempotency_key_invalid": 400, "unauthenticated": 401,
    "bad_credentials": 401, "forbidden": 403, "not_holder": 403, "out_of_scope": 403, "not_found": 404,
    "method_not_allowed": 405, "payload_too_large": 413, "unsupported_media_type": 415, "validation": 422,
    "storage_unavailable": 503,
}


class ApiError(Exception):
    """Raised anywhere in a request; the app turns it into {"error": {"code", "message", ...extra}}."""

    def __init__(self, code: str, message: str | None = None, **extra):
        super().__init__(code)
        self.code = code
        self.status = STATUS.get(code, 409)
        self.message = message or MESSAGES[code]
        self.extra = extra

    def body(self) -> dict:
        return {"error": {"code": self.code, "message": self.message, **self.extra}}


def invalid(fields: dict[str, str]) -> ApiError:
    return ApiError("validation", fields=fields)


def reason(body: dict, message: str = "Give a reason of 1 to 500 characters.") -> str:
    """Every reason field: 1 to 500 characters."""
    value = body.get("reason")
    if not isinstance(value, str) or not value.strip() or len(value) > 500:
        raise invalid({"reason": message})
    return value.strip()
