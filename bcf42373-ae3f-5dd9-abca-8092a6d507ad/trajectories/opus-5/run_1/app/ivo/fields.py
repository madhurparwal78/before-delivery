"""Field limits, the editable-field list and the one set of field messages."""

import re

DISCIPLINES = ("ui-ux", "3d-web", "frontend")
DISCIPLINE_LABELS = {"ui-ux": "UI/UX", "3d-web": "3D WEB", "frontend": "FRONTEND"}
PROJECT_TYPES = ("ui-ux", "3d-web", "frontend", "other")

EDITABLE_FIELDS = (
    "title",
    "discipline",
    "summary",
    "challenge",
    "approach",
    "outcome",
    "stack",
    "year",
    "featured",
    "position",
)
CREATE_ONLY_FIELDS = ("slug",)
REQUIRED_ON_CREATE = ("title", "slug", "discipline", "year", "position")
INQUIRY_FIELDS = ("name", "phone", "email", "message", "project_type")

SLUG_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
PHONE_PATTERN = re.compile(r"^[0-9 +\-()]+$")
CONTROL_CHARACTERS = re.compile(r"[\x00-\x1f]")

REQUIRED = "This field is required."
NOT_TEXT = "Use text."
NOT_WHOLE_NUMBER = "Use a whole number."
NOT_BOOLEAN = "Use true or false."
SLUG_SHAPE = "Use lowercase letters, digits and single hyphens."
DISCIPLINE_CHOICE = "Choose ui-ux, 3d-web or frontend."
PROJECT_TYPE_CHOICE = "Choose ui-ux, 3d-web, frontend or other."
PHONE_CHARACTERS = "Use digits, spaces, +, -, ( and ) only."
EMAIL_INVALID = "Enter a valid email address."
CONTROL_CHARACTERS_MESSAGE = "Remove control characters."
CANNOT_BE_SET = "This field cannot be set."
EMPTY_EDIT = "Send at least one field to change."

CASE_STUDY_TEXT_LIMITS = {
    "title": (1, 80),
    "slug": (1, 64),
    "summary": (0, 200),
    "stack": (0, 200),
    "challenge": (0, 2000),
    "approach": (0, 2000),
    "outcome": (0, 2000),
}
CASE_STUDY_NUMBER_LIMITS = {"year": (1990, 2100), "position": (1, 9999)}

INQUIRY_TEXT_LIMITS = {
    "name": (1, 120),
    "phone": (7, 20),
    "email": (1, 254),
    "message": (10, 4000),
}

EMAIL_LOCAL_MAX = 64


def too_long(maximum):
    return f"Use at most {maximum} characters."


def too_short(minimum):
    return f"Use at least {minimum} characters."


def out_of_range(minimum, maximum):
    return f"Use a whole number from {minimum} to {maximum}."


def check_text(value, minimum, maximum, required):
    """Return (cleaned, message). Lengths count code points after trimming."""
    if not isinstance(value, str):
        return None, NOT_TEXT
    cleaned = value.strip()
    if not cleaned:
        return (None, REQUIRED) if required else (cleaned, None)
    length = len(cleaned)
    if length < minimum:
        return None, too_short(minimum)
    if length > maximum:
        return None, too_long(maximum)
    return cleaned, None


def check_integer(value, minimum, maximum):
    if isinstance(value, bool) or not isinstance(value, int):
        return None, NOT_WHOLE_NUMBER
    if value < minimum or value > maximum:
        return None, out_of_range(minimum, maximum)
    return value, None


def check_boolean(value):
    if not isinstance(value, bool):
        return None, NOT_BOOLEAN
    return value, None


def check_choice(value, allowed, message):
    if not isinstance(value, str):
        return None, NOT_TEXT
    cleaned = value.strip()
    if not cleaned:
        return None, REQUIRED
    if cleaned not in allowed:
        return None, message
    return cleaned, None


def check_email(value):
    """Validate an address in time proportional to its length."""
    if not isinstance(value, str):
        return None, NOT_TEXT
    cleaned = value.strip()
    if not cleaned:
        return None, REQUIRED
    if len(cleaned) > INQUIRY_TEXT_LIMITS["email"][1]:
        return None, too_long(INQUIRY_TEXT_LIMITS["email"][1])
    if any(character.isspace() for character in cleaned):
        return None, EMAIL_INVALID
    if cleaned.count("@") != 1:
        return None, EMAIL_INVALID
    local, _, domain = cleaned.partition("@")
    if not 1 <= len(local) <= EMAIL_LOCAL_MAX:
        return None, EMAIL_INVALID
    labels = domain.split(".")
    if len(labels) < 2 or any(not label for label in labels):
        return None, EMAIL_INVALID
    return cleaned, None


def _check_shaped(value, pattern, shape_message, limits):
    """Shape before length, so both messages stay reachable."""
    if not isinstance(value, str):
        return None, NOT_TEXT
    cleaned = value.strip()
    if not cleaned:
        return None, REQUIRED
    if not pattern.match(cleaned):
        return None, shape_message
    return check_text(cleaned, *limits, required=True)


def check_phone(value):
    return _check_shaped(
        value, PHONE_PATTERN, PHONE_CHARACTERS, INQUIRY_TEXT_LIMITS["phone"]
    )


def check_name(value):
    if isinstance(value, str) and CONTROL_CHARACTERS.search(value):
        return None, CONTROL_CHARACTERS_MESSAGE
    return check_text(value, *INQUIRY_TEXT_LIMITS["name"], required=True)


def check_slug(value):
    return _check_shaped(
        value, SLUG_PATTERN, SLUG_SHAPE, CASE_STUDY_TEXT_LIMITS["slug"]
    )
