"""The rules of Mela that do not need the database.

Each rule lives here once: the registration status edges, the card state choice,
the address-visibility decision, the queue ordinal, the guest id form, the safe
`next` decision, the capacity checks and the countdown wording.
"""

import re
from datetime import datetime, timezone
from urllib.parse import unquote
from zoneinfo import ZoneInfo

CAPACITY_RANGE_MESSAGE = (
    "Capacity must be a whole number from 1 to 10,000, or empty for unlimited"
)
CAPACITY_MIN = 1
CAPACITY_MAX = 10000

GUEST_ID_PATTERN = re.compile(r"[1-9][0-9]{0,18}")
IDEMPOTENCY_KEY_PATTERN = re.compile(r"[A-Za-z0-9_-]{1,64}")
SCHEME_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*:")
BIGINT_MAX = 9223372036854775807

ACTIVE_STATUSES = ("pending", "approved", "waitlisted", "declined")

HOST_ACTIONS = {
    "approve": {"pending": "approved", "waitlisted": "approved"},
    "decline": {"pending": "declined", "waitlisted": "declined"},
    "remove": {"approved": "declined"},
}


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def ordinal(number: int) -> str:
    """`1st`, `2nd`, `11th`, `21st`, `111th`."""
    if number % 100 in (11, 12, 13):
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(number % 10, "th")
    return f"{number}{suffix}"


def join_names(names: list[str]) -> str:
    if len(names) <= 1:
        return "".join(names)
    return f"{', '.join(names[:-1])} and {names[-1]}"


def guest_id_from_path(raw: str) -> int | None:
    """A guest id is a canonical positive whole number; anything else is unknown."""
    if not GUEST_ID_PATTERN.fullmatch(raw):
        return None
    value = int(raw)
    return value if value <= BIGINT_MAX else None


def is_valid_idempotency_key(raw: str) -> bool:
    return bool(IDEMPOTENCY_KEY_PATTERN.fullmatch(raw))


def safe_next(raw: str | None) -> str | None:
    """A `next` target is kept only when it stays on Mela's own origin."""
    if not raw:
        return None
    decoded = unquote(raw)
    if not decoded.startswith("/") or decoded.startswith("//"):
        return None
    if "\\" in decoded or SCHEME_PATTERN.search(decoded):
        return None
    if any(ord(char) < 0x20 or ord(char) == 0x7F for char in decoded):
        return None
    return raw


def has_ended(event: dict, now: datetime | None = None) -> bool:
    return event["end_at"] <= (now or now_utc())


def is_full(event: dict) -> bool:
    return event["capacity"] is not None and event["going_count"] >= event["capacity"]


def can_see_address(event: dict) -> bool:
    """Only the host and approved guests ever see the street address or link."""
    return bool(event["is_host"]) or event["viewer_status"] == "approved"


def card_state(event: dict, now: datetime | None = None) -> str:
    """The one Registration card state, by the first rule that applies."""
    if event["is_host"]:
        return "host"
    if has_ended(event, now):
        return "past"
    if event["viewer_status"] in ACTIVE_STATUSES:
        return event["viewer_status"]
    if event["registration_status"] == "closed":
        return "closed"
    if event["registration_status"] == "code_only":
        return "code_only"
    if is_full(event):
        return "full"
    return "open"


def shows_meter(event: dict, state: str) -> bool:
    if event["capacity"] is None:
        return False
    return state not in ("declined", "closed", "code_only", "past")


def days_since_end(event: dict, now: datetime | None = None) -> int:
    seconds = ((now or now_utc()) - event["end_at"]).total_seconds()
    return max(0, int(seconds // 86400))


def past_body(event: dict, now: datetime | None = None) -> str:
    days = days_since_end(event, now)
    if days == 0:
        return "This event ended today."
    if days == 1:
        return "This event ended 1 day ago."
    return f"This event ended {days} days ago."


def _unit(value: int, singular: str, plural: str, pad: bool) -> str:
    number = f"{value:02d}" if pad else str(value)
    return f"{number} {singular if value == 1 else plural}"


def countdown_text(event: dict, now: datetime | None = None) -> str | None:
    """`3 days 04 hrs 12 min`, `5 hrs 07 min 09 sec` or `Happening now`."""
    moment = now or now_utc()
    if moment >= event["end_at"]:
        return None
    seconds = int((event["start_at"] - moment).total_seconds())
    if seconds <= 0:
        return "Happening now"
    days, rest = divmod(seconds, 86400)
    hours, rest = divmod(rest, 3600)
    minutes, secs = divmod(rest, 60)
    if days >= 1:
        return " ".join(
            [
                _unit(days, "day", "days", False),
                _unit(hours, "hr", "hrs", True),
                _unit(minutes, "min", "min", True),
            ]
        )
    return " ".join(
        [
            _unit(hours, "hr", "hrs", False),
            _unit(minutes, "min", "min", True),
            _unit(secs, "sec", "sec", True),
        ]
    )


def places_left_text(event: dict) -> str:
    if not is_full(event):
        left = event["places_left"]
        return "1 place left" if left == 1 else f"{left} places left"
    waiting = event["waitlist_count"]
    if waiting:
        return f"Full · {waiting} waiting"
    return "Full · waitlist open" if event["waitlist"] else "Full"


def meter_line(event: dict) -> str:
    return f"{event['going_count']} of {event['capacity']} places taken"


def capacity_floor_message(going: int) -> str:
    guests = "1 guest" if going == 1 else f"{going} guests"
    return f"Capacity cannot be lower than the {guests} already going"


def check_capacity_range(value: int | None) -> str | None:
    if value is None:
        return None
    if value < CAPACITY_MIN or value > CAPACITY_MAX:
        return CAPACITY_RANGE_MESSAGE
    return None


def allowed_registration_statuses(event: dict) -> tuple[str, ...]:
    """An event with an access code moves between `code_only` and `closed`."""
    if event.get("has_access_code"):
        return ("code_only", "closed")
    return ("open", "closed")


def registration_status_message(event: dict) -> str:
    allowed = allowed_registration_statuses(event)
    return f"Registration status must be {allowed[0]} or {allowed[1]}"


def in_zone(moment: datetime, zone: str) -> datetime:
    return moment.astimezone(ZoneInfo(zone))


def iso_utc(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def clock(moment: datetime) -> str:
    hour = moment.hour % 12 or 12
    return f"{hour}:{moment.minute:02d} {'AM' if moment.hour < 12 else 'PM'}"


def long_date(moment: datetime) -> str:
    return f"{moment.strftime('%A')}, {moment.strftime('%B')} {moment.day}"


def short_date(moment: datetime) -> str:
    return f"{moment.strftime('%a')}, {moment.strftime('%b')} {moment.day}"


def time_range(start: datetime, end: datetime) -> str:
    return f"{clock(start)} - {clock(end)}"


def list_moment(moment: datetime) -> str:
    """`Wed, Oct 21, 5:00 PM` as shown in event lists."""
    return f"{short_date(moment)}, {clock(moment)}"


def date_range(start: datetime, end: datetime) -> str:
    if start.date() == end.date():
        return long_date(start)
    if (start.year, start.month) == (end.year, end.month):
        return f"{start.strftime('%b')} {start.day} - {end.day}"
    return f"{start.strftime('%b')} {start.day} - {end.strftime('%b')} {end.day}"
