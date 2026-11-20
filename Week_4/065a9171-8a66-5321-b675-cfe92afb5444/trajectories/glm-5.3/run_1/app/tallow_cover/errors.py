"""The one error shape and its precedence order."""


class ApiError(Exception):
    STATUS = {
        "not_signed_in": 401,
        "invalid_credentials": 401,
        "forbidden": 403,
        "own_request": 403,
        "skill_required": 403,
        "cross_origin": 403,
        "not_found": 404,
        "method_not_allowed": 405,
        "invalid_transition": 409,
        "floor_breach": 409,
        "already_taken": 409,
        "cover_closed": 409,
        "no_open_gap": 409,
        "no_rostered_shift": 409,
        "already_clocked_in": 409,
        "no_open_clock_in": 409,
        "clock_out_window_closed": 409,
        "not_late": 409,
        "overlapping_shift": 409,
        "overlaps_existing_leave": 409,
        "already_started": 409,
        "fit_note_missing": 409,
        "attendance_exists": 409,
        "has_attendance": 409,
        "version_exists": 409,
        "period_closed": 409,
        "period_not_ended": 409,
        "idempotency_key_reused": 409,
        "storage_pending": 409,
        "stale_version": 412,
        "too_large": 413,
        "unsupported_media_type": 415,
        "unsupported_file": 415,
        "version_required": 428,
        "validation": 422,
    }
    MESSAGE = {
        "not_signed_in": "Sign in to continue.",
        "invalid_credentials": "That email and password don't match.",
        "forbidden": "You don't have permission to do that.",
        "own_request": "You can't decide your own leave request.",
        "skill_required": "This cover shift needs a senior.",
        "cross_origin": "Cross-origin requests are refused.",
        "not_found": "Not found.",
        "method_not_allowed": "This record can't be changed.",
        "already_taken": "This shift has already been taken.",
        "cover_closed": "This cover shift is no longer open.",
        "no_open_gap": "That shift has no uncovered gap for this skill.",
        "no_rostered_shift": "You have no rostered shift to clock in to right now.",
        "already_clocked_in": "You're already clocked in.",
        "no_open_clock_in": "You're not clocked in.",
        "clock_out_window_closed": "Your shift ended more than 4 hours ago. Ask your manager to add your clock-out.",
        "not_late": "This clock-in wasn't late.",
        "overlapping_shift": "That overlaps another shift for this person.",
        "overlaps_existing_leave": "You already have leave or a request covering these dates.",
        "already_started": "This leave has already started. Ask HR to cancel it.",
        "fit_note_missing": "Upload a fit note before closing this sickness record.",
        "attendance_exists": "This shift already has attendance.",
        "has_attendance": "This shift has attendance and can't be removed.",
        "version_exists": "A version already starts on that date.",
        "period_closed": "This pay period is already closed.",
        "period_not_ended": "This pay period hasn't ended yet.",
        "idempotency_key_reused": "This Idempotency-Key was used for a different request.",
        "storage_pending": "Still storing this file. Try again in a minute.",
        "stale_version": "Someone changed this record. Reload and try again.",
        "too_large": "That's too large to send.",
        "unsupported_media_type": "Send JSON.",
        "unsupported_file": "Upload a PDF, JPEG or PNG of your fit note.",
        "version_required": "Send the record's version in If-Match.",
        "validation": "Check the highlighted fields.",
    }

    def __init__(self, code, **extra):
        self.code = code
        self.extra = extra
        self.field_errors = extra.pop("errors", None)
        self.message = extra.pop("message", None) or self.MESSAGE[code]
        super().__init__(self.message)

    @property
    def status(self):
        return self.STATUS[self.code]

    def body(self):
        out = {"error": self.code, "message": self.message}
        out.update(self.extra)
        if self.field_errors:
            out["errors"] = self.field_errors
        return out


def invalid_transition(status, action):
    STATUS_LABELS = {"draft": "Draft", "submitted": "Submitted", "escalated": "Escalated",
                     "cover_pending": "Cover pending", "approved": "Approved",
                     "declined": "Declined", "withdrawn": "Withdrawn", "cancelled": "Cancelled"}
    return ApiError("invalid_transition",
                    message=f"This request is {STATUS_LABELS[status]} and can't be {action}.",
                    status=status)


def floor_breach(breaches):
    n = len(breaches)
    word = "shift" if n == 1 else "shifts"
    return ApiError("floor_breach",
                    message=f"Approving would leave {n} {word} below floor.",
                    breaches=breaches)


def validation(field_errors):
    return ApiError("validation", errors=field_errors)


def field_cant_be_set(key):
    return validation({key: "This field can't be set."})
