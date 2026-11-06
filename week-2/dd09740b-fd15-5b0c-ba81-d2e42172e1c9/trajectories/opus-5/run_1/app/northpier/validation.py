"""Field checks. Every value is checked for its JSON type before use, never coerced."""

from __future__ import annotations

import json
import math
import re
from datetime import datetime
from typing import Any

from . import errors
from .calendar_rules import (
    BOOKING_HORIZON,
    is_closure_day,
    on_quarter_hour,
    parse_call_at,
    to_stockholm,
    within_studio_hours,
)
from .domain import (
    BUDGETS,
    DECLINE_REASONS,
    QUEUE_TABS,
    SERVICES,
    TIMELINES,
    count_characters,
    has_unsupported_characters,
    normalise_text,
    valid_email,
)

MAX_BODY_BYTES = 65536
MAX_JSON_DEPTH = 32
IDEMPOTENCY_KEY_PATTERN = re.compile(r"^[A-Za-z0-9_-]{8,64}$")

NAME_MAX = 80
COMPANY_MAX = 120
MESSAGE_MIN = 20
MESSAGE_MAX = 2000
NOTE_MAX = 1000
SEARCH_MAX = 100


def _json_depth_within_limit(value: Any, limit: int = MAX_JSON_DEPTH) -> bool:
    stack: list[tuple[Any, int]] = [(value, 1)]
    while stack:
        current, depth = stack.pop()
        if depth > limit:
            return False
        if isinstance(current, dict):
            stack.extend((item, depth + 1) for item in current.values())
        elif isinstance(current, list):
            stack.extend((item, depth + 1) for item in current)
    return True


def _without_non_finite(value: Any) -> Any:
    """Numbers JSON can write but PostgreSQL cannot hold become null, once, here."""
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, dict):
        return {key: _without_non_finite(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_without_non_finite(item) for item in value]
    return value


def parse_json_object(raw: bytes) -> dict[str, Any]:
    """A POST body must be a JSON object within the size and nesting limits."""
    if len(raw) > MAX_BODY_BYTES:
        raise errors.body_too_large()
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError, RecursionError):
        raise errors.invalid_body() from None
    if not isinstance(value, dict):
        raise errors.invalid_body()
    if not _json_depth_within_limit(value):
        raise errors.invalid_body()
    return _without_non_finite(value)


def check_idempotency_key(raw: str | None) -> str | None:
    if raw is None:
        return None
    if not IDEMPOTENCY_KEY_PATTERN.match(raw):
        raise errors.malformed_key()
    return raw


# ---------------------------------------------------------------------------
# Inquiry fields, checked in form order
# ---------------------------------------------------------------------------


class ValidInquiry:
    def __init__(
        self,
        name: str,
        email: str,
        company: str | None,
        services: list[str],
        budget: str,
        timeline: str,
        message: str,
    ) -> None:
        self.name = name
        self.email = email
        self.company = company
        self.services = services
        self.budget = budget
        self.timeline = timeline
        self.message = message


def _check_name(raw: Any) -> str:
    if not isinstance(raw, str):
        raise errors.blank_name()
    if has_unsupported_characters(raw):
        raise errors.unsupported_characters("name")
    value = normalise_text(raw)
    if not value:
        raise errors.blank_name()
    if count_characters(raw) > NAME_MAX:
        raise errors.name_too_long()
    return value


def _check_email(raw: Any) -> str:
    if not isinstance(raw, str):
        raise errors.malformed_email()
    if has_unsupported_characters(raw):
        raise errors.unsupported_characters("email")
    value = normalise_text(raw).lower()
    if not valid_email(value):
        raise errors.malformed_email()
    return value


def _check_company(body: dict[str, Any]) -> str | None:
    raw = body.get("company")
    if raw is None:
        return None
    if not isinstance(raw, str):
        raise errors.company_too_long()
    if has_unsupported_characters(raw):
        raise errors.unsupported_characters("company")
    value = normalise_text(raw)
    if count_characters(raw) > COMPANY_MAX:
        raise errors.company_too_long()
    return value or None


def _check_services(raw: Any) -> list[str]:
    if not isinstance(raw, list) or not all(isinstance(item, str) for item in raw):
        raise errors.no_service()
    if not raw or any(item not in SERVICES for item in raw):
        raise errors.no_service()
    return list(dict.fromkeys(raw))


def _check_budget(raw: Any) -> str:
    if not isinstance(raw, str) or raw not in BUDGETS:
        raise errors.no_budget()
    return raw


def _check_timeline(raw: Any) -> str:
    if not isinstance(raw, str) or raw not in TIMELINES:
        raise errors.no_timeline()
    return raw


def _check_message(raw: Any) -> str:
    if not isinstance(raw, str):
        raise errors.message_too_short()
    if has_unsupported_characters(raw, allow_breaks=True):
        raise errors.unsupported_characters("message")
    length = count_characters(raw)
    if length < MESSAGE_MIN:
        raise errors.message_too_short()
    if length > MESSAGE_MAX:
        raise errors.message_too_long()
    return normalise_text(raw)


def check_inquiry(body: dict[str, Any]) -> ValidInquiry:
    return ValidInquiry(
        name=_check_name(body.get("name")),
        email=_check_email(body.get("email")),
        company=_check_company(body),
        services=_check_services(body.get("services")),
        budget=_check_budget(body.get("budget")),
        timeline=_check_timeline(body.get("timeline")),
        message=_check_message(body.get("message")),
    )


# ---------------------------------------------------------------------------
# Transition input
# ---------------------------------------------------------------------------


def check_call_at(raw: Any, now: datetime) -> datetime:
    """The `call_at` checks, in the order of the Messages table's `call_at` rows."""
    instant = parse_call_at(raw) if isinstance(raw, str) else None
    if instant is None or instant <= now:
        raise errors.call_time_not_future()
    if instant - now > BOOKING_HORIZON:
        raise errors.call_time_too_far()
    if not within_studio_hours(instant):
        raise errors.call_time_outside_hours()
    if is_closure_day(to_stockholm(instant).date()):
        raise errors.call_time_closure_day()
    if not on_quarter_hour(instant):
        raise errors.call_time_off_quarter()
    return instant


def check_decline_reason(raw: Any) -> str:
    if not isinstance(raw, str) or raw not in DECLINE_REASONS:
        raise errors.no_decline_reason()
    return raw


def check_version(raw: Any, current: int) -> int:
    if not isinstance(raw, int) or isinstance(raw, bool) or raw != current:
        raise errors.stale_version()
    return raw


# ---------------------------------------------------------------------------
# Notes and the queue
# ---------------------------------------------------------------------------


def check_note_body(raw: Any) -> str:
    if not isinstance(raw, str):
        raise errors.blank_note()
    if has_unsupported_characters(raw, allow_breaks=True):
        raise errors.unsupported_characters("body")
    length = count_characters(raw)
    if length == 0:
        raise errors.blank_note()
    if length > NOTE_MAX:
        raise errors.note_too_long()
    return normalise_text(raw)


def check_queue_params(status: str | None, search: str | None) -> tuple[str, str]:
    tab = "new" if status is None or status == "" else status
    if tab not in QUEUE_TABS:
        raise errors.unknown_tab()
    raw = search or ""
    if has_unsupported_characters(raw):
        raise errors.unsupported_characters("q")
    query = normalise_text(raw)
    if count_characters(raw) > SEARCH_MAX:
        raise errors.search_too_long()
    return tab, query
