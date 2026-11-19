"""Input forms: the required body fields, path forms and query forms.

Each form is applied in one place so every route refuses alike.
"""

from __future__ import annotations

from typing import Any

from .config import LEADERBOARD_DEFAULT_LIMIT, LEADERBOARD_MAX_LIMIT
from .errors import ApiError, validation

INT64_MAX = 9223372036854775807
NUL = "\x00"

CONTROL_RANGES = ((0x00, 0x1F), (0x7F, 0x9F))
DIRECTION_MARKS = frozenset(
    {0x061C, 0x200E, 0x200F, 0x202A, 0x202B, 0x202C, 0x202D, 0x202E}
    | set(range(0x2066, 0x206A))
)
TEAM_NAME_EXTRA = frozenset(" -_")

EMAIL_MESSAGE = "Enter a valid email"
DISPLAY_NAME_LENGTH_MESSAGE = "Display name must be 1 to 40 characters"
DISPLAY_NAME_CHARACTER_MESSAGE = (
    "Display name cannot contain control or direction characters"
)
PASSWORD_MESSAGE = "Password must be 8 to 128 characters"
TEAM_NAME_MESSAGE = (
    "Team names are 3 to 24 letters, digits, spaces, hyphens or underscores"
)


def _is_control(character: str) -> bool:
    point = ord(character)
    return any(low <= point <= high for low, high in CONTROL_RANGES)


def required_text(body: dict[str, Any], field: str) -> str:
    """Step 8 of the error precedence, for one required body field."""
    value = body.get(field)
    if not isinstance(value, str):
        return _refuse(field)
    if NUL in value or not value.strip():
        return _refuse(field)
    return value


def _refuse(field: str) -> str:
    raise validation(field, f"{field.replace('_', ' ').capitalize()} is required")


def required_texts(body: dict[str, Any], *fields: str) -> dict[str, str]:
    """Several required body fields at once, reporting every failing field."""
    values: dict[str, str] = {}
    problems: dict[str, str] = {}
    for field in fields:
        try:
            values[field] = required_text(body, field)
        except ApiError as error:
            problems.update(error.fields or {})
    if problems:
        raise ApiError(400, "validation", problems)
    return values


def digits_only(raw: str, limit: int = INT64_MAX) -> int | None:
    """A whole number written in ASCII digits, no sign and no leading zero."""
    if not raw or not all("0" <= character <= "9" for character in raw):
        return None
    if raw[0] == "0" and raw != "0":
        return None
    value = int(raw)
    if value < 1 or value > limit:
        return None
    return value


def path_user_id(raw: str) -> int:
    value = digits_only(raw)
    if value is None:
        raise ApiError(404, "not_a_member")
    return value


def path_slug(raw: str) -> str:
    if len(raw) > 64 or NUL in raw or any(ord(character) > 127 for character in raw):
        raise ApiError(404, "unknown_scenario")
    return raw


def leaderboard_paging(query: dict[str, str]) -> tuple[int, int, bool]:
    page = _query_number(query, "page", 1)
    limit = _query_number(query, "limit", LEADERBOARD_DEFAULT_LIMIT)
    include_feed = query.get("include_feed")
    if include_feed not in (None, "0", "1"):
        raise validation("include_feed", "include_feed must be 0 or 1")
    return page, min(limit, LEADERBOARD_MAX_LIMIT), include_feed == "1"


def _query_number(query: dict[str, str], field: str, default: int) -> int:
    raw = query.get(field)
    if raw is None:
        return default
    value = digits_only(raw)
    if value is None:
        raise validation(field, f"{field} must be a whole number of at least 1")
    return value


# -- account fields -------------------------------------------------------
def normalise_email(raw: str) -> str:
    return raw.strip().lower()


def email_problem(normalised: str) -> str | None:
    if not 3 <= len(normalised) <= 254:
        return EMAIL_MESSAGE
    if normalised.count("@") != 1:
        return EMAIL_MESSAGE
    local, _, domain = normalised.partition("@")
    if not local or not domain or "." not in domain:
        return EMAIL_MESSAGE
    for character in normalised:
        if character.isspace() or _is_control(character):
            return EMAIL_MESSAGE
    return None


def display_name_problem(raw: str) -> str | None:
    for character in raw:
        if _is_control(character) or ord(character) in DIRECTION_MARKS:
            return DISPLAY_NAME_CHARACTER_MESSAGE
    if not 1 <= len(raw.strip()) <= 40:
        return DISPLAY_NAME_LENGTH_MESSAGE
    return None


def password_problem(password: str) -> str | None:
    if not 8 <= len(password) <= 128:
        return PASSWORD_MESSAGE
    return None


def team_name_problem(raw: str) -> str | None:
    name = raw.strip()
    if not 3 <= len(name) <= 24:
        return TEAM_NAME_MESSAGE
    for character in name:
        allowed = (
            character.isascii() and character.isalnum()
        ) or character in TEAM_NAME_EXTRA
        if not allowed:
            return TEAM_NAME_MESSAGE
    return None
