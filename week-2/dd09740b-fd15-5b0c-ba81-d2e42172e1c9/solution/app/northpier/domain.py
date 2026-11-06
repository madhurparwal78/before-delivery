"""The inquiry domain: labels, the Transitions table, text rules and the inquiry form check."""
import datetime as dt
import re
from dataclasses import dataclass
from typing import Any

from northpier.errors import Refusal, unsupported
from northpier.studio_time import call_label

STATUS_LABELS = {"new": "New", "in_review": "In review", "call_booked": "Call booked", "won": "Won",
                 "declined": "Declined"}
DECLINE_REASONS = {"outside_services": "Outside our services", "timeline": "Timeline does not fit",
                   "budget": "Budget does not fit", "fully_booked": "Fully booked"}
SERVICES = {"strategy": "Strategy", "branding": "Branding", "design": "Design", "development": "Development"}
BUDGETS = {"under_25k": "Under 25k EUR", "25k_75k": "25k to 75k EUR", "75k_150k": "75k to 150k EUR",
           "over_150k": "Over 150k EUR"}
TIMELINES = {"asap": "As soon as possible", "within_3_months": "Within 3 months",
             "3_to_6_months": "In 3 to 6 months", "exploring": "Just exploring"}
STATUS_LINES = {
    "new": "We have your inquiry and will look at it shortly.",
    "in_review": "We are reading through your project and may get in touch with questions.",
    "call_booked": "Your intro call is booked for {call} Stockholm time.",
    "won": "We are starting together. We will be in touch with next steps.",
    "declined": "We are not the right fit this time: {reason}. Thank you for thinking of us.",
}
QUEUE_TABS = ("new", "in_review", "call_booked", "won", "declined", "all")
TAB_LABELS = {**STATUS_LABELS, "all": "All"}


def status_line(status: str, call_at: dt.datetime | None, decline_reason: str | None) -> str:
    """The visitor-facing sentence for a status (Business rules 1)."""
    if status == "call_booked":
        return STATUS_LINES[status].format(call=call_label(call_at))
    if status == "declined":
        return STATUS_LINES[status].format(reason=DECLINE_REASONS[decline_reason])
    return STATUS_LINES[status]


@dataclass(frozen=True)
class Transition:
    action: str
    from_statuses: frozenset[str]
    to_status: str
    roles: frozenset[str]
    label: str


LEAD, ASSOCIATE = "lead", "associate"
TRANSITIONS: tuple[Transition, ...] = (
    Transition("start_review", frozenset({"new"}), "in_review", frozenset({LEAD, ASSOCIATE}), "Start review"),
    Transition("book_call", frozenset({"in_review"}), "call_booked", frozenset({LEAD, ASSOCIATE}), "Book call"),
    Transition("reschedule_call", frozenset({"call_booked"}), "call_booked", frozenset({LEAD, ASSOCIATE}),
               "Reschedule call"),
    Transition("mark_won", frozenset({"call_booked"}), "won", frozenset({LEAD}), "Mark won"),
    Transition("decline", frozenset({"new", "in_review", "call_booked"}), "declined", frozenset({LEAD}), "Decline"),
    Transition("reopen", frozenset({"declined"}), "in_review", frozenset({LEAD}), "Reopen"),
)
TRANSITIONS_BY_ACTION = {transition.action: transition for transition in TRANSITIONS}
CALL_ACTIONS = frozenset({"book_call", "reschedule_call"})


def allowed_actions(status: str, role: str) -> list[Transition]:
    """The Transitions table rows whose from includes `status` and whose who includes `role`, in table order."""
    return [t for t in TRANSITIONS if status in t.from_statuses and role in t.roles]


# Text: U+0000..U+001F, U+007F and lone surrogates are unsupported; tab, LF and CR only in multi-line fields.
_UNSUPPORTED_LINE = re.compile("[\x00-\x1f\x7f\ud800-\udfff]")
_UNSUPPORTED_MULTILINE = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\ud800-\udfff]")


def normalized(value: str) -> str:
    """Trimmed, with each CR LF pair turned into one LF: the form every length limit counts."""
    return value.strip().replace("\r\n", "\n")


def char_count(value: str) -> int:
    """Unicode code points of the normalized value."""
    return len(normalized(value))


def has_unsupported(value: str, multiline: bool = False) -> bool:
    """True when the value as sent holds a character the desk never stores."""
    return bool((_UNSUPPORTED_MULTILINE if multiline else _UNSUPPORTED_LINE).search(value))


def check_characters(field: str, value: str, multiline: bool = False) -> None:
    """The unsupported-character refusal for `field`, judged on the value as sent."""
    if has_unsupported(value, multiline):
        raise unsupported(field)


_EMAIL = re.compile(r"[^\s@]+@[^\s@]*[^\s@.][.][^\s@.][^\s@]*")


def _email_ok(value: str) -> bool:
    return len(value) <= 254 and bool(_EMAIL.fullmatch(value))


@dataclass(frozen=True)
class InquiryFields:
    name: str
    email: str
    company: str | None
    services: list[str]
    budget: str
    timeline: str
    message: str


def validate_inquiry(body: dict[str, Any]) -> InquiryFields:
    """The inquiry form check in form order; the first failing field refuses."""
    name = body.get("name")
    if type(name) is not str:
        raise Refusal("name_blank")
    check_characters("name", name)
    if char_count(name) == 0:
        raise Refusal("name_blank")
    if char_count(name) > 80:
        raise Refusal("name_long")

    email = body.get("email")
    if type(email) is not str:
        raise Refusal("email")
    check_characters("email", email)
    email = normalized(email)
    if not _email_ok(email):
        raise Refusal("email")

    company = body.get("company")
    if company is not None:
        if type(company) is not str:
            raise Refusal("company_long")
        check_characters("company", company)
        if char_count(company) > 120:
            raise Refusal("company_long")

    services = body.get("services")
    if (type(services) is not list or not services
            or any(type(item) is not str or item not in SERVICES for item in services)):
        raise Refusal("services")

    budget = body.get("budget")
    if type(budget) is not str or budget not in BUDGETS:
        raise Refusal("budget")

    timeline = body.get("timeline")
    if type(timeline) is not str or timeline not in TIMELINES:
        raise Refusal("timeline")

    message = body.get("message")
    if type(message) is not str:
        raise Refusal("message_short")
    check_characters("message", message, multiline=True)
    if char_count(message) < 20:
        raise Refusal("message_short")
    if char_count(message) > 2000:
        raise Refusal("message_long")

    return InquiryFields(
        name=normalized(name), email=email.lower(), company=normalized(company) or None if company else None,
        services=[key for key in SERVICES if key in services], budget=budget, timeline=timeline,
        message=normalized(message))


def validate_note(body: dict[str, Any]) -> str:
    note = body.get("body")
    if type(note) is not str:
        raise Refusal("note_blank")
    check_characters("body", note, multiline=True)
    if char_count(note) == 0:
        raise Refusal("note_blank")
    if char_count(note) > 1000:
        raise Refusal("note_long")
    return normalized(note)


def first_name(name: str) -> str:
    return name.strip().split(" ", 1)[0]
