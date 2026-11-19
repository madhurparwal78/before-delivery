"""The one error shape. Every API error is built here."""

STATUS_BY_CODE = {
    "idempotency_key_required": 400,
    "idempotency_key_invalid": 400,
    "bad_credentials": 401,
    "unauthenticated": 401,
    "forbidden": 403,
    "not_holder": 403,
    "out_of_scope": 403,
    "not_found": 404,
    "method_not_allowed": 405,
    "idempotency_mismatch": 409,
    "invalid_transition": 409,
    "directive_withdrawn": 409,
    "effectivity_unconfirmed": 409,
    "revision_changed": 409,
    "card_held": 409,
    "past_due": 409,
    "already_deferred": 409,
    "directive_exists": 409,
    "revision_out_of_order": 409,
    "not_contractor": 409,
    "already_erased": 409,
    "pack_already_queued": 409,
    "pack_not_transmitted": 409,
    "payload_too_large": 413,
    "unsupported_media_type": 415,
    "validation": 422,
    "storage_unavailable": 503,
}

MESSAGES = {
    "idempotency_key_required": "An Idempotency-Key header is required for this request.",
    "idempotency_key_invalid": "The Idempotency-Key header is not valid.",
    "bad_credentials": "Username or passcode is wrong.",
    "unauthenticated": "Your session has ended. Sign in again.",
    "forbidden": "Your role cannot do this.",
    "not_holder": "You no longer hold this work card.",
    "not_found": "No such resource.",
    "method_not_allowed": "That method is not allowed on this path.",
    "idempotency_mismatch": "That idempotency key was used with a different request body.",
    "payload_too_large": "That body is larger than the limit for this endpoint.",
    "unsupported_media_type": "That content type is not accepted here.",
    "validation": "Some fields need attention.",
    "storage_unavailable": "Object storage is unavailable.",
    "effectivity_unconfirmed": "Waiting for the planner to confirm effectivity.",
    "past_due": "Too late to defer: the due instant has passed.",
    "not_contractor": "Only contractor records can be erased.",
    "already_erased": "This person was already erased.",
    "pack_not_transmitted": "This pack has not been transmitted yet.",
}


class ApiError(Exception):
    """Carries one error body: {"error":{"code","message", ...extra}}."""

    def __init__(self, code, message=None, status=None, **extra):
        self.code = code
        self.status = status or STATUS_BY_CODE[code]
        self.message = message or MESSAGES.get(code, "That request could not be completed.")
        self.extra = extra
        super().__init__(self.message)

    def body(self):
        error = {"code": self.code, "message": self.message}
        error.update(self.extra)
        return {"error": error}


def validation(fields, message="Some fields need attention."):
    return ApiError("validation", message, fields=fields)


def invalid_transition(stage, action, message=None):
    return ApiError(
        "invalid_transition",
        message or f"A thread at stage {stage} cannot take the action {action}.",
        stage=stage,
        action=action,
    )
