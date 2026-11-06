"""The one error shape and the one Messages table."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(eq=False)
class Refusal(Exception):
    """A refused request: one status, one field, one message."""

    status: int
    field: str | None
    message: str
    retry_after: int | None = None

    def body(self) -> dict[str, object]:
        return {"error": {"field": self.field, "message": self.message}}

    def headers(self) -> dict[str, str]:
        headers: dict[str, str] = {}
        if self.retry_after is not None:
            headers["Retry-After"] = str(self.retry_after)
        if self.status == 405:
            headers["Allow"] = "GET, HEAD"
        return headers


def body_too_large() -> Refusal:
    return Refusal(413, None, "Request body is too large.")


def sign_in_required() -> Refusal:
    return Refusal(401, None, "Sign in to continue.")


def not_found() -> Refusal:
    return Refusal(404, None, "Not found")


def method_not_allowed() -> Refusal:
    return Refusal(405, None, "Method not allowed")


def invalid_body() -> Refusal:
    return Refusal(400, None, "Invalid request body")


def malformed_key() -> Refusal:
    return Refusal(400, None, "Idempotency-Key must be 8 to 64 letters, digits, - or _.")


def cross_origin() -> Refusal:
    return Refusal(403, None, "Cross-origin request refused.")


def lead_only() -> Refusal:
    return Refusal(403, "action", "Only a studio lead can do this.")


def sign_in_limit(retry_after: int) -> Refusal:
    return Refusal(
        429, "email", "Too many sign-in attempts. Try again later.", retry_after=retry_after
    )


def wrong_credentials() -> Refusal:
    return Refusal(401, "email", "Incorrect email or password.")


def inquiry_key_conflict() -> Refusal:
    return Refusal(409, None, "This key was already used for a different inquiry.")


def transition_key_conflict() -> Refusal:
    return Refusal(409, None, "This key was already used for a different change.")


def stale_version() -> Refusal:
    return Refusal(
        412, "version", "This inquiry changed since you opened it. Reload to see the latest."
    )


def action_not_allowed() -> Refusal:
    return Refusal(409, "action", "This action is not allowed from the current status.")


def call_not_held() -> Refusal:
    return Refusal(409, "action", "Mark won after the intro call has taken place.")


def reopen_window_closed() -> Refusal:
    return Refusal(409, "action", "This inquiry can no longer be reopened.")


def unsupported_characters(field: str) -> Refusal:
    return Refusal(422, field, "Remove the unsupported characters.")


def blank_name() -> Refusal:
    return Refusal(422, "name", "Name is required.")


def name_too_long() -> Refusal:
    return Refusal(422, "name", "Name must be 80 characters or fewer.")


def malformed_email() -> Refusal:
    return Refusal(422, "email", "Enter a valid email address.")


def company_too_long() -> Refusal:
    return Refusal(422, "company", "Company must be 120 characters or fewer.")


def no_service() -> Refusal:
    return Refusal(422, "services", "Choose at least one service.")


def no_budget() -> Refusal:
    return Refusal(422, "budget", "Choose a budget.")


def no_timeline() -> Refusal:
    return Refusal(422, "timeline", "Choose a timeline.")


def message_too_short() -> Refusal:
    return Refusal(422, "message", "Tell us a little more: at least 20 characters.")


def message_too_long() -> Refusal:
    return Refusal(422, "message", "Message must be 2000 characters or fewer.")


def call_time_not_future() -> Refusal:
    return Refusal(422, "call_at", "Choose a call time in the future.")


def call_time_too_far() -> Refusal:
    return Refusal(422, "call_at", "Choose a call time within the next 90 days.")


def call_time_outside_hours() -> Refusal:
    return Refusal(
        422,
        "call_at",
        "Calls are booked on weekdays between 09:00 and 17:00 Stockholm time.",
    )


def call_time_closure_day() -> Refusal:
    return Refusal(422, "call_at", "The studio is closed that day.")


def call_time_off_quarter() -> Refusal:
    return Refusal(422, "call_at", "Choose a time on a quarter hour.")


def no_decline_reason() -> Refusal:
    return Refusal(422, "decline_reason", "Choose a reason.")


def blank_note() -> Refusal:
    return Refusal(422, "body", "Note cannot be empty.")


def note_too_long() -> Refusal:
    return Refusal(422, "body", "Note must be 1000 characters or fewer.")


def unknown_tab() -> Refusal:
    return Refusal(422, "status", "Unknown tab.")


def search_too_long() -> Refusal:
    return Refusal(422, "q", "Search must be 100 characters or fewer.")


def call_overlap() -> Refusal:
    return Refusal(409, "call_at", "That time overlaps another booked call.")


def inquiry_flood(retry_after: int) -> Refusal:
    return Refusal(
        429,
        "email",
        "Too many inquiries from this email. Try again in an hour.",
        retry_after=retry_after,
    )


def database_unavailable() -> Refusal:
    return Refusal(503, None, "The studio desk is unavailable. Try again shortly.")


OUTAGE_MESSAGE = database_unavailable().message
