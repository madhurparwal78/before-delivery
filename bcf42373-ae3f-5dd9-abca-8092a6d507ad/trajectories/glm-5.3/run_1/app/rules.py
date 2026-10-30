"""Domain rules, each decided in exactly one place."""
import os

SIGN_IN_LOCKOUT_WINDOW_SECONDS = int(os.environ.get("SIGN_IN_LOCKOUT_WINDOW_SECONDS", "900"))
SESSION_LIFETIME_SECONDS = int(os.environ.get("SESSION_LIFETIME_SECONDS", "43200"))
SIGN_IN_LOCKOUT_REFUSALS = 5
DUPLICATE_INQUIRY_WINDOW_SECONDS = 60

DISCIPLINES = ["ui-ux", "3d-web", "frontend"]
DISCIPLINE_LABELS = {
    "ui-ux": "UI/UX",
    "3d-web": "3D WEB",
    "frontend": "FRONTEND",
}
PROJECT_TYPES = ["ui-ux", "3d-web", "frontend", "other"]
STUDIO_BUSINESS_TZ = "Pacific/Auckland"

SLUG_MAX = 64
TITLE_MAX = 80
SUMMARY_MAX = 200
STACK_MAX = 200
BODY_MAX = 2000
YEAR_MIN, YEAR_MAX = 1990, 2100
POSITION_MIN, POSITION_MAX = 1, 9999

# The editable fields, one list, used by create and edit alike.
EDITABLE_FIELDS = [
    "title", "discipline", "summary", "challenge", "approach", "outcome",
    "stack", "year", "featured", "position",
]
CREATE_FIELDS = ["slug"] + EDITABLE_FIELDS
REQUIRED_ON_CREATE = ["title", "slug", "discipline", "year", "position"]

INQUIRY_FIELDS = ["name", "phone", "email", "message", "project_type"]
INQUIRY_REQUIRED = ["name", "phone", "email", "message"]

NAME_MAX = 120
NAME_MIN = 1
PHONE_MIN, PHONE_MAX = 7, 20
EMAIL_MAX = 254
MESSAGE_MIN, MESSAGE_MAX = 10, 4000

MAX_BODY_BYTES = 32768


def is_slug(value):
    """Lowercase letters and digits in groups joined by single hyphens."""
    if not value or len(value) > SLUG_MAX:
        return False
    if value.startswith("-") or value.endswith("-") or "--" in value:
        return False
    return all(("a" <= c <= "z") or ("0" <= c <= "9") or c == "-" for c in value)


def check_email(value):
    """A bounded, linear-time email check: exactly one @, no whitespace."""
    if not isinstance(value, str) or len(value) > EMAIL_MAX:
        return False
    if "@" not in value:
        return False
    head, _, domain = value.partition("@")
    if "@" in domain:
        return False
    if not head or len(head) > 64:
        return False
    if "." not in domain:
        return False
    if domain.startswith(".") or domain.endswith(".") or ".." in domain:
        return False
    if any(ch.isspace() or ord(ch) <= 32 for ch in value):
        return False
    return True


def is_phone(value):
    return all(c.isdigit() or c in " +-()" for c in value)


def ordinal_string(number):
    return str(number).zfill(2)
