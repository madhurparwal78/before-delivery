"""Labels, pinned copy and the single Messages table of the API."""
from __future__ import annotations

from zoneinfo import ZoneInfo

Stockholm = ZoneInfo("Europe/Stockholm")

STATUS_LABELS = {
    "new": "New",
    "in_review": "In review",
    "call_booked": "Call booked",
    "won": "Won",
    "declined": "Declined",
}

STATUS_LINES = {
    "new": "We have your inquiry and will look at it shortly.",
    "in_review": "We are reading through your project and may get in touch with questions.",
    "call_booked": "Your intro call is booked for {call_time} Stockholm time.",
    "won": "We are starting together. We will be in touch with next steps.",
    "declined": "We are not the right fit this time: {reason_label}. Thank you for thinking of us.",
}

DECLINE_REASONS = {
    "outside_services": "Outside our services",
    "timeline": "Timeline does not fit",
    "budget": "Budget does not fit",
    "fully_booked": "Fully booked",
}

SERVICES = {
    "strategy": "Strategy",
    "branding": "Branding",
    "design": "Design",
    "development": "Development",
}

BUDGETS = {
    "under_25k": "Under 25k EUR",
    "25k_75k": "25k to 75k EUR",
    "75k_150k": "75k to 150k EUR",
    "over_150k": "Over 150k EUR",
}

TIMELINES = {
    "asap": "As soon as possible",
    "within_3_months": "Within 3 months",
    "3_to_6_months": "In 3 to 6 months",
    "exploring": "Just exploring",
}

WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]


def call_time_label(call_at) -> str:
    """The pinned Stockholm wall-clock label, e.g. 'Thursday 5 November, 14:00'."""
    stockholm = call_at.astimezone(Stockholm)
    return "{weekday} {day} {month}, {hh}:{mm}".format(
        weekday=WEEKDAYS[stockholm.weekday()],
        day=stockholm.day,
        month=MONTHS[stockholm.month - 1],
        hh=f"{stockholm.hour:02d}",
        mm=f"{stockholm.minute:02d}",
    )


def status_line(status: str, call_at=None, decline_reason: str | None = None) -> str:
    if status == "call_booked":
        return STATUS_LINES[status].format(call_time=call_time_label(call_at))
    if status == "declined":
        return STATUS_LINES[status].format(reason_label=DECLINE_REASONS.get(decline_reason or "", ""))
    return STATUS_LINES[status]


# The Messages table, as (status, field, message) triples.
TOO_LARGE = (413, None, "Request body is too large.")
SIGN_IN_REQUIRED = (401, None, "Sign in to continue.")
NOT_FOUND = (404, None, "Not found")
METHOD_NOT_ALLOWED = (405, None, "Method not allowed")
INVALID_BODY = (400, None, "Invalid request body")
BAD_IDEMPOTENCY_KEY = (400, None, "Idempotency-Key must be 8 to 64 letters, digits, - or _.")
CROSS_ORIGIN = (403, None, "Cross-origin request refused.")
LEAD_ONLY = (403, "action", "Only a studio lead can do this.")
SIGNIN_LIMIT = (429, "email", "Too many sign-in attempts. Try again later.")
WRONG_CREDENTIALS = (401, "email", "Incorrect email or password.")
INQUIRY_KEY_CONFLICT = (409, None, "This key was already used for a different inquiry.")
CHANGE_KEY_CONFLICT = (409, None, "This key was already used for a different change.")
STALE_VERSION = (412, "version", "This inquiry changed since you opened it. Reload to see the latest.")
ACTION_NOT_ALLOWED = (409, "action", "This action is not allowed from the current status.")
CALL_NOT_HELD = (409, "action", "Mark won after the intro call has taken place.")
REOPEN_CLOSED = (409, "action", "This inquiry can no longer be reopened.")
UNSUPPORTED_CHARACTER = (422, "{field}", "Remove the unsupported characters.")
NAME_REQUIRED = (422, "name", "Name is required.")
NAME_TOO_LONG = (422, "name", "Name must be 80 characters or fewer.")
EMAIL_INVALID = (422, "email", "Enter a valid email address.")
COMPANY_TOO_LONG = (422, "company", "Company must be 120 characters or fewer.")
SERVICES_REQUIRED = (422, "services", "Choose at least one service.")
BUDGET_REQUIRED = (422, "budget", "Choose a budget.")
TIMELINE_REQUIRED = (422, "timeline", "Choose a timeline.")
MESSAGE_SHORT = (422, "message", "Tell us a little more: at least 20 characters.")
MESSAGE_LONG = (422, "message", "Message must be 2000 characters or fewer.")
CALL_MISSING = (422, "call_at", "Choose a call time in the future.")
CALL_TOO_FAR = (422, "call_at", "Choose a call time within the next 90 days.")
CALL_HOURS = (422, "call_at", "Calls are booked on weekdays between 09:00 and 17:00 Stockholm time.")
CALL_CLOSED = (422, "call_at", "The studio is closed that day.")
CALL_QUARTER = (422, "call_at", "Choose a time on a quarter hour.")
DECLINE_REASON_REQUIRED = (422, "decline_reason", "Choose a reason.")
NOTE_EMPTY = (422, "body", "Note cannot be empty.")
NOTE_LONG = (422, "body", "Note must be 1000 characters or fewer.")
UNKNOWN_TAB = (422, "status", "Unknown tab.")
SEARCH_TOO_LONG = (422, "q", "Search must be 100 characters or fewer.")
CALL_OVERLAP = (409, "call_at", "That time overlaps another booked call.")
FLOOD_LIMIT = (429, "email", "Too many inquiries from this email. Try again in an hour.")
UNAVAILABLE = (503, None, "The studio desk is unavailable. Try again shortly.")
