"""The one API error shape, and the one catalogue of codes and messages."""

from __future__ import annotations

ERROR_CATALOGUE: dict[str, tuple[int, str]] = {
    "not_signed_in": (401, "Sign in to continue."),
    "invalid_credentials": (401, "That email and password don't match."),
    "forbidden": (403, "You don't have permission to do that."),
    "own_request": (403, "You can't decide your own leave request."),
    "skill_required": (403, "This cover shift needs a senior."),
    "cross_origin": (403, "Cross-origin requests are refused."),
    "not_found": (404, "Not found."),
    "method_not_allowed": (405, "This record can't be changed."),
    "invalid_transition": (409, ""),
    "floor_breach": (409, ""),
    "already_taken": (409, "This shift has already been taken."),
    "cover_closed": (409, "This cover shift is no longer open."),
    "no_open_gap": (409, "That shift has no uncovered gap for this skill."),
    "no_rostered_shift": (409, "You have no rostered shift to clock in to right now."),
    "already_clocked_in": (409, "You're already clocked in."),
    "no_open_clock_in": (409, "You're not clocked in."),
    "clock_out_window_closed": (
        409,
        "Your shift ended more than 4 hours ago. Ask your manager to add your clock-out.",
    ),
    "not_late": (409, "This clock-in wasn't late."),
    "overlapping_shift": (409, "That overlaps another shift for this person."),
    "overlaps_existing_leave": (409, "You already have leave or a request covering these dates."),
    "already_started": (409, "This leave has already started. Ask HR to cancel it."),
    "fit_note_missing": (409, "Upload a fit note before closing this sickness record."),
    "attendance_exists": (409, "This shift already has attendance."),
    "has_attendance": (409, "This shift has attendance and can't be removed."),
    "version_exists": (409, "A version already starts on that date."),
    "period_closed": (409, "This pay period is already closed."),
    "period_not_ended": (409, "This pay period hasn't ended yet."),
    "idempotency_key_reused": (409, "This Idempotency-Key was used for a different request."),
    "storage_pending": (409, "Still storing this file. Try again in a minute."),
    "stale_version": (412, "Someone changed this record. Reload and try again."),
    "too_large": (413, "That's too large to send."),
    "unsupported_media_type": (415, "Send JSON."),
    "unsupported_file": (415, "Upload a PDF, JPEG or PNG of your fit note."),
    "version_required": (428, "Send the record's version in If-Match."),
    "validation": (422, "Check the highlighted fields."),
}

FIELD_MESSAGES = {
    "unknown_key": "This field can't be set.",
    "type": "Choose annual, unpaid or compassionate leave.",
    "leave_start_past": "Leave can't start in the past.",
    "end_before_start": "The last day can't be before the first day.",
    "too_many_days": "Leave can be at most 28 days.",
    "crosses_leave_year": "Leave can't cross 31 March. Split it into two requests.",
    "note_too_long": "Keep the note to 500 characters or fewer.",
    "reason": "Give a reason of 1 to 500 characters.",
    "sickness_start": "Sickness can start up to 28 days ago and not in the future.",
    "last_sick_date": "The last day off sick must be between the first day and today.",
    "display_name": "Use 1 to 60 characters.",
    "min_staff": "Use a whole number from 0 to 30.",
    "min_seniors": "Use a whole number no larger than the minimum staff.",
    "effective_from": "Choose a date after today.",
    "notice_multiplier": "Use a whole number from 0 to 6.",
    "instant": "Use a full date and time with a UTC offset.",
    "clock_out_order": "Clock out must be after clock in.",
    "clock_in_window": "Clock in must be within 4 hours of the rostered start.",
    "period": "Use a month like 2026-09.",
    "queue_status": "Choose a queue status.",
    "person_id": "Only care workers and bank carers can be rostered.",
    "home_ids_empty": "Choose at least one home.",
    "home_ids_unknown": "Unknown home.",
    "idempotency_key": "Send an Idempotency-Key of 1 to 100 characters.",
    "from": "Choose a date inside this request.",
}

STATUS_LABELS = {
    "draft": "Draft",
    "submitted": "Submitted",
    "escalated": "Escalated",
    "cover_pending": "Cover pending",
    "approved": "Approved",
    "declined": "Declined",
    "withdrawn": "Withdrawn",
    "cancelled": "Cancelled",
    "reported": "Reported",
    "fit_note_required": "Fit note required",
    "evidenced": "Evidenced",
    "closed": "Closed",
}


class ApiError(Exception):
    """Every refusal the API makes."""

    def __init__(self, code: str, *, message: str | None = None, **extra):
        status, catalogue_message = ERROR_CATALOGUE[code]
        super().__init__(code)
        self.code = code
        self.status = status
        self.message = message if message is not None else catalogue_message
        self.extra = extra

    def body(self) -> dict:
        payload = {"error": self.code, "message": self.message}
        payload.update(self.extra)
        return payload


def validation_error(errors: dict[str, str]) -> ApiError:
    return ApiError("validation", errors=errors)


def invalid_transition(status: str, action: str) -> ApiError:
    label = STATUS_LABELS[status]
    return ApiError(
        "invalid_transition",
        message=f"This request is {label} and can't be {action}.",
        status=status,
    )


def unsupported_file() -> ApiError:
    return ApiError("unsupported_file", errors={"file": ERROR_CATALOGUE["unsupported_file"][1]})


def floor_breach(breaches: list[dict]) -> ApiError:
    count = len(breaches)
    noun = "shift" if count == 1 else "shifts"
    return ApiError(
        "floor_breach",
        message=f"Approving would leave {count} {noun} below floor.",
        breaches=breaches,
    )
