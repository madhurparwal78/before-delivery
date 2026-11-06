"""The one error shape: every refusal is built here from the brief's Messages table."""
import json
from typing import NamedTuple

from django.http import HttpResponse


class Message(NamedTuple):
    status: int
    field: str | None
    text: str


MESSAGES: dict[str, Message] = {
    "too_large": Message(413, None, "Request body is too large."),
    "sign_in": Message(401, None, "Sign in to continue."),
    "not_found": Message(404, None, "Not found"),
    "method": Message(405, None, "Method not allowed"),
    "body": Message(400, None, "Invalid request body"),
    "key": Message(400, None, "Idempotency-Key must be 8 to 64 letters, digits, - or _."),
    "cross_origin": Message(403, None, "Cross-origin request refused."),
    "lead_only": Message(403, "action", "Only a studio lead can do this."),
    "signin_limit": Message(429, "email", "Too many sign-in attempts. Try again later."),
    "credentials": Message(401, "email", "Incorrect email or password."),
    "inquiry_key": Message(409, None, "This key was already used for a different inquiry."),
    "change_key": Message(409, None, "This key was already used for a different change."),
    "stale": Message(412, "version", "This inquiry changed since you opened it. Reload to see the latest."),
    "not_allowed": Message(409, "action", "This action is not allowed from the current status."),
    "not_held": Message(409, "action", "Mark won after the intro call has taken place."),
    "window_closed": Message(409, "action", "This inquiry can no longer be reopened."),
    "name_blank": Message(422, "name", "Name is required."),
    "name_long": Message(422, "name", "Name must be 80 characters or fewer."),
    "email": Message(422, "email", "Enter a valid email address."),
    "company_long": Message(422, "company", "Company must be 120 characters or fewer."),
    "services": Message(422, "services", "Choose at least one service."),
    "budget": Message(422, "budget", "Choose a budget."),
    "timeline": Message(422, "timeline", "Choose a timeline."),
    "message_short": Message(422, "message", "Tell us a little more: at least 20 characters."),
    "message_long": Message(422, "message", "Message must be 2000 characters or fewer."),
    "future": Message(422, "call_at", "Choose a call time in the future."),
    "too_far": Message(422, "call_at", "Choose a call time within the next 90 days."),
    "hours": Message(422, "call_at", "Calls are booked on weekdays between 09:00 and 17:00 Stockholm time."),
    "closed": Message(422, "call_at", "The studio is closed that day."),
    "quarter": Message(422, "call_at", "Choose a time on a quarter hour."),
    "reason": Message(422, "decline_reason", "Choose a reason."),
    "note_blank": Message(422, "body", "Note cannot be empty."),
    "note_long": Message(422, "body", "Note must be 1000 characters or fewer."),
    "tab": Message(422, "status", "Unknown tab."),
    "q_long": Message(422, "q", "Search must be 100 characters or fewer."),
    "overlap": Message(409, "call_at", "That time overlaps another booked call."),
    "flood": Message(429, "email", "Too many inquiries from this email. Try again in an hour."),
    "outage": Message(503, None, "The studio desk is unavailable. Try again shortly."),
}
UNSUPPORTED = "Remove the unsupported characters."


class Refusal(Exception):
    """Raised anywhere in a request to answer with one Messages-table refusal."""

    def __init__(self, kind: str, field: str | None = None, retry_after: int | None = None,
                 allow: str = "GET, HEAD") -> None:
        super().__init__(kind)
        self.kind = kind
        self.unsupported_field = field
        self.retry_after = retry_after
        self.allow = allow

    @property
    def message(self) -> Message:
        if self.kind == "unsupported":
            return Message(422, self.unsupported_field, UNSUPPORTED)
        return MESSAGES[self.kind]


def unsupported(field: str) -> Refusal:
    return Refusal("unsupported", field)


def json_response(payload: object, status: int = 200) -> HttpResponse:
    return HttpResponse(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), status=status,
                        content_type="application/json; charset=utf-8")


def refuse(refusal: Refusal) -> HttpResponse:
    message = refusal.message
    response = json_response({"error": {"field": message.field, "message": message.text}}, message.status)
    if refusal.retry_after is not None:
        response["Retry-After"] = str(refusal.retry_after)
    if refusal.kind == "method":
        response["Allow"] = refusal.allow
    return response
