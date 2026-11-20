"""The single API error shape: {"error", "message"} plus "errors" or a code's extra fields."""

from starlette.responses import JSONResponse

CODES: dict[str, tuple[int, str]] = {
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
    "clock_out_window_closed": (409, "Your shift ended more than 4 hours ago. Ask your manager to add your clock-out."),
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


class ApiError(Exception):
    """Raised anywhere in a request; `web.py` turns it into the one error body."""

    def __init__(self, code: str, message: str | None = None, **extra):
        super().__init__(code)
        self.code = code
        self.status, default = CODES[code]
        self.message = message or default
        self.extra = extra

    def response(self) -> JSONResponse:
        return JSONResponse({"error": self.code, "message": self.message, **self.extra}, status_code=self.status,
                            headers={"Cache-Control": "no-store"})


def invalid(**errors: str) -> ApiError:
    return ApiError("validation", errors=errors)


def unsupported_file() -> ApiError:
    return ApiError("unsupported_file", errors={"file": CODES["unsupported_file"][1]})


REASON_MAX = 500
REASON_MSG = "Give a reason of 1 to 500 characters."


def reason(value) -> str | None:
    """A reason is 1 to 500 characters of text."""
    return value if isinstance(value, str) and 1 <= len(value) <= REASON_MAX else None


UNPUBLISHED_MSG = "This field can't be set."


class Fields:
    """Collects field messages while a handler reads its body, so validation can be raised last.

    It starts with one entry per body key the endpoint does not publish."""

    def __init__(self, body: dict, published: tuple[str, ...]):
        self.body = body
        self.errors: dict[str, str] = {key: UNPUBLISHED_MSG for key in body if key not in published}

    def fail(self, field: str, message: str) -> None:
        self.errors.setdefault(field, message)

    def ok(self, *fields: str) -> bool:
        return not any(f in self.errors for f in fields)

    def check(self) -> None:
        if self.errors:
            raise invalid(**self.errors)
