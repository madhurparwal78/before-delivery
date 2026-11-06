"""Domain rules: transitions, studio hours, closure days, quarter hours,
Stockholm conversion, character counting and the email validation."""
from __future__ import annotations

import datetime as dt
import re

from .labels import Stockholm

CALL_MINUTES = 45
STUDIO_OPEN = dt.time(9, 0)
STUDIO_CLOSE = dt.time(17, 0)
MAX_CALL_AHEAD_DAYS = 90

# The Transitions table, defined once. Every surface that lists, offers or
# applies an action reads it.
TRANSITIONS = [
    {"action": "start_review", "from": ("new",), "to": "in_review", "roles": ("lead", "associate")},
    {"action": "book_call", "from": ("in_review",), "to": "call_booked", "roles": ("lead", "associate")},
    {"action": "reschedule_call", "from": ("call_booked",), "to": "call_booked", "roles": ("lead", "associate")},
    {"action": "mark_won", "from": ("call_booked",), "to": "won", "roles": ("lead",)},
    {"action": "decline", "from": ("new", "in_review", "call_booked"), "to": "declined", "roles": ("lead",)},
    {"action": "reopen", "from": ("declined",), "to": "in_review", "roles": ("lead",)},
]

ACTION_ORDER = [t["action"] for t in TRANSITIONS]

TRANSITIONS_BY_ACTION = {t["action"]: t for t in TRANSITIONS}


def transition_from(action: str, status: str) -> dict | None:
    spec = TRANSITIONS_BY_ACTION.get(action)
    if spec and status in spec["from"]:
        return spec
    return None


def allowed_actions(status: str, role: str) -> list[str]:
    return [
        t["action"]
        for t in TRANSITIONS
        if status in t["from"] and role in t["roles"]
    ]


def is_lead_only(action: str) -> bool:
    spec = TRANSITIONS_BY_ACTION.get(action)
    return bool(spec) and "lead" in spec["roles"] and "associate" not in spec["roles"]


# ---------------------------------------------------------------- characters


def has_unsupported_character(value: str, allow_newlines: bool) -> bool:
    """U+0000-U+001F, U+007F and any unpaired surrogate escape are unsupported."""
    for ch in value:
        code = ord(ch)
        if 0xD800 <= code <= 0xDFFF:
            return True
        if code <= 0x1F or code == 0x7F:
            if allow_newlines and ch in "\t\n\r":
                continue
            return True
    return False


def normalise_newlines(value: str) -> str:
    return value.replace("\r\n", "\n").replace("\r", "\n")


def count_text(value: str) -> int:
    """Unicode code points of the newline-normalised value."""
    return len(normalise_newlines(value))


def trim_count(value: str) -> int:
    """Unicode code points after trimming and newline normalisation."""
    return len(normalise_newlines(value).strip())


EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def valid_email(value: str) -> bool:
    if len(value) > 254 or any(ch.isspace() for ch in value):
        return False
    return bool(EMAIL_RE.match(value))


# ---------------------------------------------------------------- calendar


def _easter_sunday(year: int) -> dt.date:
    # Western (Gregorian) Easter.
    a = year % 19
    b, c = divmod(year, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 12)
    l = (i + 32 - 2 * e + h) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = ((h + l - 7 * m + 114) % 31) + 1
    return dt.date(year, month, day)


def _friday_between_19_and_25_june(year: int) -> dt.date:
    june19 = dt.date(year, 6, 19)
    return june19 + dt.timedelta(days=(4 - june19.weekday()) % 7)


def closure_dates(year: int) -> set[dt.date]:
    easter = _easter_sunday(year)
    return {
        dt.date(year, 1, 1),
        dt.date(year, 1, 6),
        easter - dt.timedelta(days=2),   # Good Friday
        easter + dt.timedelta(days=1),   # Easter Monday
        dt.date(year, 5, 1),
        easter + dt.timedelta(days=39),  # Ascension Day
        dt.date(year, 6, 6),
        _friday_between_19_and_25_june(year),  # Midsummer Eve
        dt.date(year, 12, 24),
        dt.date(year, 12, 25),
        dt.date(year, 12, 26),
        dt.date(year, 12, 31),
    }


def is_closure_day(date: dt.date) -> bool:
    return date in closure_dates(date.year)


def is_studio_day(date: dt.date) -> bool:
    return date.weekday() < 5 and not is_closure_day(date)


# ---------------------------------------------------------------- call_at


WALL_CLOCK_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$")
OFFSET_RE = re.compile(
    r"^(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})"
    r"(?:Z|z|[+-]\d{2}:?\d{2})$"
)


def parse_call_at(raw: str, now: dt.datetime) -> dt.datetime | None:
    """Parse a call_at string to its UTC instant, or None when unreadable.

    A value with Z or an explicit offset is that instant; one without is a
    Stockholm wall-clock time converted with that date's offset.
    """
    if not isinstance(raw, str):
        return None
    raw = raw.strip()
    if OFFSET_RE.match(raw):
        try:
            moment = dt.datetime.fromisoformat(raw.replace("Z", "+00:00").replace("z", "+00:00"))
        except ValueError:
            return None
        return moment.astimezone(dt.timezone.utc)
    match = WALL_CLOCK_RE.match(raw)
    if not match:
        return None
    year, month, day, hour, minute = (int(match.group(i)) for i in range(1, 6))
    second = int(match.group(6) or 0)
    try:
        wall = dt.datetime(year, month, day, hour, minute, second)
    except ValueError:
        return None
    if hour == 24 and minute == 0 and second == 0:
        return None
    try:
        localised = wall.replace(tzinfo=Stockholm)
    except (ValueError, OverflowError):
        return None
    return localised.astimezone(dt.timezone.utc)


def check_call_time(call_at: dt.datetime, now: dt.datetime):
    """Check future, 90 days, Stockholm hours, closure day and quarter hour."""
    if call_at <= now:
        return "call_missing"
    if call_at - now > dt.timedelta(days=MAX_CALL_AHEAD_DAYS):
        return "call_too_far"
    local = call_at.astimezone(Stockholm)
    end = local + dt.timedelta(minutes=CALL_MINUTES)
    if (
        local.weekday() > 4
        or local.time() < STUDIO_OPEN
        or end.date() != local.date()
        or end.time() > STUDIO_CLOSE
    ):
        return "call_hours"
    if is_closure_day(local.date()):
        return "call_closed"
    if local.minute % 15 != 0 or local.second != 0:
        return "call_quarter"
    return None


def call_bounds(call_at: dt.datetime) -> tuple[dt.datetime, dt.datetime]:
    return call_at, call_at + dt.timedelta(minutes=CALL_MINUTES)


# ---------------------------------------------------------------- references

REFERENCE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

TOKEN_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"


