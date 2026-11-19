"""Input forms: strict JSON, required body fields, and the published limits.

The strict JSON reading and the path and query input forms are each applied in
one place, not re-implemented per route.
"""

import json
import math
import re

from .errors import invalid_json, validation, not_a_member

MAX_INT = 9223372036854775807
_ASCII_DIGITS = re.compile(r"[0-9]+")
_TEAM_NAME_RE = re.compile(r"[A-Za-z0-9 _-]+")
_CONTROL = set(chr(c) for c in range(0x00, 0x20)) | {chr(0x7f)} | \
    set(chr(c) for c in range(0x80, 0xa0))
_DIRECTION = {chr(0x061c), chr(0x200e), chr(0x200f)} | \
    set(chr(c) for c in range(0x202a, 0x202f)) | \
    set(chr(c) for c in range(0x2066, 0x206a))


def _reject_constant(name):
    raise _BadJson()


class _BadJson(Exception):
    pass


def _pairs(items):
    out = {}
    for key, value in items:
        if key in out:
            raise _BadJson()
        out[key] = value
    return out


def _check_shape(value, depth):
    if isinstance(value, dict):
        if depth > 32:
            raise _BadJson()
        for child in value.values():
            _check_shape(child, depth + 1)
    elif isinstance(value, list):
        if depth > 32:
            raise _BadJson()
        for child in value:
            _check_shape(child, depth + 1)
    elif isinstance(value, str):
        for char in value:
            if "\ud800" <= char <= "\udfff":
                raise _BadJson()
    elif isinstance(value, float) and not math.isfinite(value):
        raise _BadJson()


def read_strict_json(raw):
    """A strict JSON object, or 400 invalid_json. Refuses invalid UTF-8,
    non-object top level, NaN and Infinity, duplicate member names, lone
    surrogate escapes and nesting deeper than 32 levels."""
    try:
        text = raw.decode("utf-8")
        value = json.loads(text, parse_constant=_reject_constant,
                           object_pairs_hook=_pairs)
        _check_shape(value, 1)
    except (UnicodeDecodeError, _BadJson, ValueError):
        raise invalid_json()
    if not isinstance(value, dict):
        raise invalid_json()
    return value


def require_text(body, field, message):
    """A required body field: present, a string, not blank after trimming,
    and free of U+0000. Anything else answers 400 validation."""
    value = body.get(field)
    if not isinstance(value, str) or not value.strip() or "\x00" in value:
        raise validation(field, message)
    return value


def path_user_id(raw):
    """A path {user_id}: ASCII digits, no sign, no leading zero, at most
    MAX_INT. Any other form answers 404 not_a_member."""
    if not _ASCII_DIGITS.fullmatch(raw or "") or len(raw) > 19:
        raise not_a_member()
    if len(raw) > 1 and raw[0] == "0":
        raise not_a_member()
    if int(raw) > MAX_INT:
        raise not_a_member()
    return int(raw)


def query_positive(raw, name):
    """A leaderboard query value: ASCII digits, no sign, no leading zero,
    from 1 to MAX_INT. Any other value answers 400 validation."""
    if not _ASCII_DIGITS.fullmatch(raw or "") or len(raw) > 19:
        raise validation(name, "Enter a whole number of 1 or more")
    if len(raw) > 1 and raw[0] == "0":
        raise validation(name, "Enter a whole number of 1 or more")
    if int(raw) > MAX_INT:
        raise validation(name, "Enter a whole number of 1 or more")
    return int(raw)


def query_flag(raw, name):
    if raw not in ("0", "1"):
        raise validation(name, "Enter 0 or 1")
    return raw == "1"


# --- account fields ----------------------------------------------------------

def normalise_email(raw, field="email"):
    """The email is trimmed of surrounding whitespace and lower-cased before
    any check, comparison or storage."""
    email = raw.strip().lower()
    message = "Enter a valid email"
    if not 3 <= len(email) <= 254:
        raise validation(field, message)
    if email.count("@") != 1:
        raise validation(field, message)
    local, _, domain = email.partition("@")
    if not local or not domain or "." not in domain:
        raise validation(field, message)
    for char in email:
        if char.isspace() or char in _CONTROL:
            raise validation(field, message)
    return email


def normalise_display_name(raw):
    """The display name is trimmed and stored trimmed. Control and direction
    characters are checked on the name as sent, before trimming."""
    message_range = "Display name must be 1 to 40 characters"
    message_control = "Display name cannot contain control or direction characters"
    for char in raw:
        if char in _CONTROL or char in _DIRECTION:
            raise validation("display_name", message_control)
    name = raw.strip()
    if not 1 <= len(name) <= 40:
        raise validation("display_name", message_range)
    return name


def normalise_password(raw):
    """The password is used exactly as sent: never trimmed and never
    shortened. Every code point counts."""
    if not 8 <= len(raw) <= 128:
        raise validation("password", "Password must be 8 to 128 characters")
    if "\x00" in raw:
        raise validation("password", "Password must be 8 to 128 characters")
    return raw


def normalise_team_name(raw):
    name = raw.strip()
    message = "Team names are 3 to 24 letters, digits, spaces, hyphens or underscores"
    if not 3 <= len(name) <= 24:
        raise validation("name", message)
    if not _TEAM_NAME_RE.fullmatch(name):
        raise validation("name", message)
    return name


def normalise_invite_code(raw):
    return raw.strip().upper()
