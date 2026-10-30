"""Field rules for case studies, inquiries and sign-in, and the one refusal type the API answers with."""

import re

DISCIPLINES = {"ui-ux": "UI/UX", "3d-web": "3D WEB", "frontend": "FRONTEND"}
PROJECT_TYPES = {"ui-ux": "UI/UX", "3d-web": "3D WEB", "frontend": "FRONTEND", "other": "OTHER"}
EDITABLE_FIELDS = ("title", "discipline", "summary", "challenge", "approach", "outcome", "stack", "year",
                   "featured", "position")
SLUG_SHAPE = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
TEXT_LIMITS = {"title": (1, 80), "slug": (1, 64), "summary": (0, 200), "stack": (0, 200),
               "challenge": (0, 2000), "approach": (0, 2000), "outcome": (0, 2000)}
NUMBER_LIMITS = {"year": (1990, 2100), "position": (1, 9999)}
REQUIRED_ON_CREATE = ("title", "slug", "discipline", "year", "position")
INQUIRY_FIELDS = ("name", "phone", "email", "message", "project_type")
INQUIRY_LIMITS = {"name": (1, 120), "phone": (7, 20), "message": (10, 4000)}
PHONE_CHARACTERS = re.compile(r"[0-9 +\-()]*")
EMAIL_MAX = 254
EMAIL_LOCAL_MAX = 64

REQUIRED = "This field is required."
NOT_SETTABLE = "This field cannot be set."
USE_TEXT = "Use text."
CONTROL_CHARACTERS = "Remove control characters."
DISCIPLINE_CHOICE = "Choose ui-ux, 3d-web or frontend."


class Refused(Exception):
    """A client error the API answers in the one refusal shape (and pages as their own states)."""

    def __init__(self, status: int, reason: str, errors: dict | None = None, headers: dict | None = None):
        super().__init__(reason)
        self.status = status
        self.reason = reason
        self.errors = errors
        self.headers = headers or {}


def invalid(errors: dict) -> Refused:
    return Refused(422, "Some fields need attention.", errors)


def not_found() -> Refused:
    return Refused(404, "Not found.")


def _has_control(text: str) -> bool:
    return any(ord(char) < 32 for char in text)


def _text_problem(value) -> str | None:
    """A JSON string PostgreSQL can store: no NUL byte and no lone surrogate."""
    if not isinstance(value, str):
        return USE_TEXT
    if "\x00" in value:
        return CONTROL_CHARACTERS
    try:
        value.encode("utf-8")
    except UnicodeEncodeError:
        return USE_TEXT
    return None


def _length_problem(text: str, low: int, high: int) -> str | None:
    if not text and low:
        return REQUIRED
    if len(text) < low:
        return f"Use at least {low} characters."
    if len(text) > high:
        return f"Use at most {high} characters."
    return None


def _number_problem(value, low: int, high: int) -> str | None:
    if isinstance(value, bool) or not isinstance(value, int):
        return "Use a whole number."
    if not low <= value <= high:
        return f"Use a whole number from {low} to {high}."
    return None


def case_changes(body: dict, creating: bool) -> dict:
    """Validate a create or edit body; answer the cleaned values or refuse naming every failing field."""
    accepted = EDITABLE_FIELDS + ("slug",) if creating else EDITABLE_FIELDS
    errors = {key: NOT_SETTABLE for key in body if key not in accepted}
    if not creating and not body:
        errors["body"] = "Send at least one field to change."
    if creating:
        errors.update({key: REQUIRED for key in REQUIRED_ON_CREATE if key not in body})
    values = {}
    for key, value in body.items():
        if key not in accepted:
            continue
        if key in TEXT_LIMITS:
            problem = _text_problem(value)
            if problem is None:
                value = value if key == "slug" else value.strip()
                problem = _length_problem(value, *TEXT_LIMITS[key])
            if problem is None and key == "slug" and not SLUG_SHAPE.fullmatch(value):
                problem = "Use lowercase letters, digits and single hyphens."
        elif key == "discipline":
            problem = None if isinstance(value, str) and value in DISCIPLINES else DISCIPLINE_CHOICE
        elif key == "featured":
            problem = None if isinstance(value, bool) else "Use true or false."
        else:
            problem = _number_problem(value, *NUMBER_LIMITS[key])
        if problem:
            errors[key] = problem
        else:
            values[key] = value
    if errors:
        raise invalid(errors)
    return values


def publish_problems(case: dict) -> dict:
    """The publish requirement: a published case study keeps a non-blank summary and outcome."""
    problems = {}
    if not case["summary"].strip():
        problems["summary"] = "Add a summary before publishing."
    if not case["outcome"].strip():
        problems["outcome"] = "Add an outcome before publishing."
    return problems


def publish_choice(body: dict) -> bool:
    errors = {key: NOT_SETTABLE for key in body if key != "published"}
    if "published" not in body:
        errors["published"] = REQUIRED
    elif not isinstance(body["published"], bool):
        errors["published"] = "Use true or false."
    if errors:
        raise invalid(errors)
    return body["published"]


def email_problem(email: str) -> str | None:
    """One linear pass over the address: one @, no whitespace, a 1-64 character local part, a dotted domain."""
    if len(email) > EMAIL_MAX:
        return f"Use at most {EMAIL_MAX} characters."
    local, at, domain = email.partition("@")
    if (not at or "@" in domain or any(char.isspace() for char in email)
            or not 1 <= len(local) <= EMAIL_LOCAL_MAX or "." not in domain
            or "" in domain.split(".")):
        return "Enter a valid email address."
    return None


def inquiry_values(body: dict) -> dict:
    errors = {key: NOT_SETTABLE for key in body if key not in INQUIRY_FIELDS}
    values = {"project_type": None}
    for key in ("name", "phone", "email", "message"):
        if key not in body:
            errors[key] = REQUIRED
            continue
        problem = _text_problem(body[key])
        if problem is None:
            text = body[key].strip()
            if key == "email":
                problem = REQUIRED if not text else email_problem(text)
            else:
                problem = _length_problem(text, *INQUIRY_LIMITS[key])
            if problem is None and key == "name" and _has_control(text):
                problem = CONTROL_CHARACTERS
            if problem is None and key == "phone" and not PHONE_CHARACTERS.fullmatch(text):
                problem = "Use digits, spaces, +, -, ( and ) only."
        if problem:
            errors[key] = problem
        else:
            values[key] = text
    if "project_type" in body:
        if isinstance(body["project_type"], str) and body["project_type"] in PROJECT_TYPES:
            values["project_type"] = body["project_type"]
        else:
            errors["project_type"] = "Choose ui-ux, 3d-web, frontend or other."
    if errors:
        raise invalid(errors)
    return values


def sign_in_email(body: dict) -> str | None:
    """The trimmed, lowercased email when the body carries one as usable text."""
    email = body.get("email")
    if _text_problem(email) is None and email.strip():
        return email.strip().lower()
    return None


def sign_in_problems(body: dict) -> dict:
    errors = {key: NOT_SETTABLE for key in body if key not in ("email", "password")}
    for key in ("email", "password"):
        value = body.get(key)
        problem = REQUIRED if key not in body else _text_problem(value)
        if problem is None and not value.strip():
            problem = REQUIRED
        if problem:
            errors[key] = problem
    return errors
