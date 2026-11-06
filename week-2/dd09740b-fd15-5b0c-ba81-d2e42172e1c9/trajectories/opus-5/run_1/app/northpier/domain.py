"""The inquiry desk's domain: statuses, labels, the transitions table and text rules."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from .calendar_rules import format_call_time

LEAD = "lead"
ASSOCIATE = "associate"

STATUS_NEW = "new"
STATUS_IN_REVIEW = "in_review"
STATUS_CALL_BOOKED = "call_booked"
STATUS_WON = "won"
STATUS_DECLINED = "declined"

#: The five pipeline statuses, in queue-tab order.
STATUSES: tuple[str, ...] = (
    STATUS_NEW,
    STATUS_IN_REVIEW,
    STATUS_CALL_BOOKED,
    STATUS_WON,
    STATUS_DECLINED,
)

QUEUE_TABS: tuple[str, ...] = (*STATUSES, "all")

STATUS_LABELS: dict[str, str] = {
    STATUS_NEW: "New",
    STATUS_IN_REVIEW: "In review",
    STATUS_CALL_BOOKED: "Call booked",
    STATUS_WON: "Won",
    STATUS_DECLINED: "Declined",
}

DECLINE_REASONS: dict[str, str] = {
    "outside_services": "Outside our services",
    "timeline": "Timeline does not fit",
    "budget": "Budget does not fit",
    "fully_booked": "Fully booked",
}

SERVICES: dict[str, str] = {
    "strategy": "Strategy",
    "branding": "Branding",
    "design": "Design",
    "development": "Development",
}

BUDGETS: dict[str, str] = {
    "under_25k": "Under 25k EUR",
    "25k_75k": "25k to 75k EUR",
    "75k_150k": "75k to 150k EUR",
    "over_150k": "Over 150k EUR",
}

TIMELINES: dict[str, str] = {
    "asap": "As soon as possible",
    "within_3_months": "Within 3 months",
    "3_to_6_months": "In 3 to 6 months",
    "exploring": "Just exploring",
}

def status_line(status: str, call_at: datetime | None, decline_reason: str | None) -> str:
    """The visitor-facing line for a status (Business rules 1)."""
    if status == STATUS_NEW:
        return "We have your inquiry and will look at it shortly."
    if status == STATUS_IN_REVIEW:
        return "We are reading through your project and may get in touch with questions."
    if status == STATUS_CALL_BOOKED:
        when = format_call_time(call_at) if call_at else ""
        return f"Your intro call is booked for {when} Stockholm time."
    if status == STATUS_WON:
        return "We are starting together. We will be in touch with next steps."
    reason = DECLINE_REASONS.get(decline_reason or "", "")
    return f"We are not the right fit this time: {reason}. Thank you for thinking of us."


# ---------------------------------------------------------------------------
# The transitions table. Defined once; every surface reads it.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Transition:
    action: str
    from_statuses: tuple[str, ...]
    to_status: str
    roles: tuple[str, ...]
    needs_call_at: bool = False
    needs_decline_reason: bool = False


TRANSITIONS: tuple[Transition, ...] = (
    Transition("start_review", (STATUS_NEW,), STATUS_IN_REVIEW, (LEAD, ASSOCIATE)),
    Transition(
        "book_call",
        (STATUS_IN_REVIEW,),
        STATUS_CALL_BOOKED,
        (LEAD, ASSOCIATE),
        needs_call_at=True,
    ),
    Transition(
        "reschedule_call",
        (STATUS_CALL_BOOKED,),
        STATUS_CALL_BOOKED,
        (LEAD, ASSOCIATE),
        needs_call_at=True,
    ),
    Transition("mark_won", (STATUS_CALL_BOOKED,), STATUS_WON, (LEAD,)),
    Transition(
        "decline",
        (STATUS_NEW, STATUS_IN_REVIEW, STATUS_CALL_BOOKED),
        STATUS_DECLINED,
        (LEAD,),
        needs_decline_reason=True,
    ),
    Transition("reopen", (STATUS_DECLINED,), STATUS_IN_REVIEW, (LEAD,)),
)

TRANSITIONS_BY_ACTION: dict[str, Transition] = {t.action: t for t in TRANSITIONS}

LEAD_ONLY_ACTIONS: tuple[str, ...] = tuple(
    t.action for t in TRANSITIONS if t.roles == (LEAD,)
)

ACTION_LABELS: dict[str, str] = {
    "start_review": "Start review",
    "book_call": "Book call",
    "reschedule_call": "Reschedule call",
    "mark_won": "Mark won",
    "decline": "Decline",
    "reopen": "Reopen",
}


def allowed_actions(status: str, role: str) -> list[str]:
    """Actions the transitions table gives this role from this status, in table order."""
    return [t.action for t in TRANSITIONS if status in t.from_statuses and role in t.roles]


def transition_for(action: str, status: str) -> Transition | None:
    transition = TRANSITIONS_BY_ACTION.get(action)
    if transition is None or status not in transition.from_statuses:
        return None
    return transition


# ---------------------------------------------------------------------------
# Text and characters (Business rules 15)
# ---------------------------------------------------------------------------

_CONTROL_CHARS = frozenset(chr(code) for code in range(0x00, 0x20)) | {chr(0x7F)}


def normalise_text(value: str) -> str:
    """Fold CRLF to LF and trim surrounding whitespace, as every length check does."""
    return value.replace("\r\n", "\n").strip()


def count_characters(value: str) -> int:
    """Count Unicode code points the way every limit in the brief counts them."""
    return len(normalise_text(value))


def has_unsupported_characters(value: str, *, allow_breaks: bool = False) -> bool:
    """True when the raw value holds a character the desk refuses."""
    allowed = {"\t", "\n", "\r"} if allow_breaks else set()
    for char in value:
        if 0xD800 <= ord(char) <= 0xDFFF:
            return True
        if char in _CONTROL_CHARS and char not in allowed:
            return True
    return False


def valid_email(value: str) -> bool:
    """Business rules 16: no whitespace, one @, non-empty local part, dotted domain."""
    if not value or len(value) > 254:
        return False
    if any(char.isspace() for char in value):
        return False
    if value.count("@") != 1:
        return False
    local, _, domain = value.partition("@")
    if not local or not domain:
        return False
    head, dot, tail = domain.partition(".")
    if not dot:
        return False
    return bool(head) and bool(tail.replace(".", "")) and not domain.endswith(".")


def first_name(name: str) -> str:
    trimmed = normalise_text(name)
    return trimmed.split(" ", 1)[0] if trimmed else trimmed
