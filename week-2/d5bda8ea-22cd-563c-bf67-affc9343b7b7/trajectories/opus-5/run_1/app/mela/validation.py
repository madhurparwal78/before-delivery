"""The one request-body check and the one set of field rules."""

import json
import re
from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from . import domain
from .catalog import (
    CATEGORY_NAME,
    LOCATION_TYPES,
    REPORT_REASONS,
    THEMES,
    VISIBILITIES,
)
from .errors import MelaError

EMAIL_PATTERN = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")
UNKNOWN_FIELD = "Unknown field"

EVENT_FIELD_TYPES = {
    "name": str,
    "description": str,
    "start_at": str,
    "end_at": str,
    "timezone": str,
    "location_type": str,
    "venue_name": str,
    "street_address": str,
    "city": str,
    "virtual_link": str,
    "visibility": str,
    "require_approval": bool,
    "capacity": "integer_or_null",
    "waitlist": bool,
    "theme": str,
    "categories": "string_list",
    "calendar": "string_or_null",
    "show_guest_list": bool,
}

EVENT_DEFAULTS = {
    "description": "",
    "timezone": "Asia/Kolkata",
    "location_type": "offline",
    "venue_name": "",
    "street_address": "",
    "city": "",
    "virtual_link": "",
    "visibility": "public",
    "require_approval": False,
    "capacity": None,
    "waitlist": False,
    "theme": "amber",
    "categories": [],
    "calendar": None,
    "show_guest_list": True,
}

TYPE_MESSAGES = {
    str: "Expected a string",
    bool: "Expected true or false",
    "integer_or_null": "Expected a whole number or null",
    "string_list": "Expected an array of strings",
    "string_or_null": "Expected a string or null",
}


def _type_ok(kind, value) -> bool:
    if kind is str:
        return isinstance(value, str)
    if kind is bool:
        return isinstance(value, bool)
    if kind == "integer_or_null":
        return value is None or (isinstance(value, int) and not isinstance(value, bool))
    if kind == "string_list":
        return isinstance(value, list) and all(isinstance(x, str) for x in value)
    return value is None or isinstance(value, str)


def parse_body(raw: bytes, field_types: dict) -> dict:
    """Accept only a JSON object holding the named keys with their exact types."""
    if not raw.strip():
        return {}
    try:
        payload = json.loads(raw)
    except ValueError:
        raise MelaError(422, errors={"body": "Expected a JSON object"}) from None
    if not isinstance(payload, dict):
        raise MelaError(422, errors={"body": "Expected a JSON object"})
    errors = {key: UNKNOWN_FIELD for key in payload if key not in field_types}
    for key, value in payload.items():
        if key in field_types and not _type_ok(field_types[key], value):
            errors[key] = TYPE_MESSAGES[field_types[key]]
    if errors:
        raise MelaError(422, errors=errors)
    return payload


def _clean_email(payload: dict, errors: dict) -> str:
    email = payload.get("email", "")
    if not isinstance(email, str) or not EMAIL_PATTERN.fullmatch(email.strip()):
        errors["email"] = "Enter a valid email address"
        return ""
    return email.strip().lower()


def check_email(payload: dict) -> str:
    errors: dict = {}
    email = _clean_email(payload, errors)
    if errors:
        raise MelaError(422, errors=errors)
    return email


def credentials(payload: dict) -> tuple[str, str]:
    """Sign-in reads credentials without judging them, so failure stays generic."""
    email = payload.get("email", "")
    password = payload.get("password", "")
    return email.strip().lower(), password


def check_signup(payload: dict) -> tuple[str, str, str]:
    errors: dict = {}
    email = _clean_email(payload, errors)
    name = payload.get("name", "")
    name = name.strip() if isinstance(name, str) else ""
    if not name:
        errors["name"] = "Enter your name"
    elif len(name) > 80:
        errors["name"] = "Name must be 80 characters or fewer"
    password = payload.get("password", "")
    if not isinstance(password, str) or len(password) < 8:
        errors["password"] = "Password must be at least 8 characters"
    elif len(password) > 200:
        errors["password"] = "Password must be 200 characters or fewer"
    if errors:
        raise MelaError(422, errors=errors)
    return name, email, password


def _parse_instant(value: str) -> datetime | None:
    try:
        moment = datetime.fromisoformat(value)
    except ValueError:
        return None
    return moment if moment.tzinfo is not None else None


def _known_zone(name: str) -> bool:
    try:
        ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return False
    return True


def check_event_fields(payload: dict, current: dict | None, followed: set[str]) -> dict:
    """Validate a create or edit body against the stored event where needed."""
    errors: dict = {}
    values: dict = {}

    def stored(field):
        if field in values:
            return values[field]
        if current is not None:
            return current[field]
        return EVENT_DEFAULTS[field]

    if "name" in payload or current is None:
        name = payload.get("name", "").strip()
        if not name:
            errors["name"] = "Event name is required"
        elif len(name) > 140:
            errors["name"] = "Event name must be 140 characters or fewer"
        else:
            values["name"] = name

    if "description" in payload:
        if len(payload["description"]) > 5000:
            errors["description"] = "Description must be 5,000 characters or fewer"
        else:
            values["description"] = payload["description"]

    for field in ("start_at", "end_at"):
        if field in payload or current is None:
            raw = payload.get(field, "")
            moment = _parse_instant(raw) if isinstance(raw, str) else None
            if moment is None:
                errors[field] = "Enter a date and time with a time zone offset"
            else:
                values[field] = moment

    if "timezone" in payload:
        if not _known_zone(payload["timezone"]):
            errors["timezone"] = "Choose a known time zone"
        else:
            values["timezone"] = payload["timezone"]

    if "location_type" in payload:
        if payload["location_type"] not in LOCATION_TYPES:
            errors["location_type"] = "Choose Offline or Virtual"
        else:
            values["location_type"] = payload["location_type"]

    if "visibility" in payload:
        if payload["visibility"] not in VISIBILITIES:
            errors["visibility"] = "Choose Public or Private"
        else:
            values["visibility"] = payload["visibility"]

    if "theme" in payload:
        if payload["theme"] not in THEMES:
            errors["theme"] = "Choose one of the six themes"
        else:
            values["theme"] = payload["theme"]

    if "categories" in payload:
        chosen = payload["categories"]
        if len(chosen) > 2:
            errors["categories"] = "Choose at most two categories"
        elif len(set(chosen)) != len(chosen):
            errors["categories"] = "Choose two different categories"
        elif any(slug not in CATEGORY_NAME for slug in chosen):
            errors["categories"] = "Choose known categories"
        else:
            values["categories"] = chosen

    if "calendar" in payload:
        calendar = payload["calendar"]
        if calendar is not None and calendar not in followed:
            errors["calendar"] = "Choose a calendar you follow"
        else:
            values["calendar"] = calendar

    if "capacity" in payload:
        message = domain.check_capacity_range(payload["capacity"])
        if message:
            errors["capacity"] = message
        else:
            values["capacity"] = payload["capacity"]

    for field in ("venue_name", "street_address", "city", "virtual_link"):
        if field in payload:
            values[field] = payload[field].strip()

    for field in ("require_approval", "waitlist", "show_guest_list"):
        if field in payload:
            values[field] = payload[field]

    if "start_at" in values and "end_at" not in errors:
        if stored("end_at") <= values["start_at"]:
            errors["end_at"] = "End must be after the start"
    elif "end_at" in values and "start_at" not in errors:
        if values["end_at"] <= stored("start_at"):
            errors["end_at"] = "End must be after the start"

    if "start_at" in values and values["start_at"] < domain.now_utc():
        errors["start_at"] = "Start cannot be in the past"

    if stored("location_type") == "offline":
        if not stored("city"):
            errors["city"] = "Enter the city"
    elif not stored("virtual_link").startswith("https://"):
        errors["virtual_link"] = "Enter a link starting with https://"

    if errors:
        raise MelaError(422, errors=errors)
    return values


def check_registration_status(event: dict, value: str) -> str:
    allowed = domain.allowed_registration_statuses(event)
    if value not in allowed:
        raise MelaError(
            422,
            errors={"registration_status": domain.registration_status_message(event)},
        )
    return value


def check_message(payload: dict) -> str:
    message = payload.get("message", "")
    text = message.strip() if isinstance(message, str) else ""
    if not text or len(text) > 1000:
        raise MelaError(
            422, errors={"message": "Write a message of 1 to 1,000 characters"}
        )
    return text


def check_report(payload: dict) -> tuple[str, str]:
    errors: dict = {}
    reason = payload.get("reason")
    if reason not in REPORT_REASONS:
        errors["reason"] = "Choose a reason"
    details = payload.get("details", "")
    if len(details) > 1000:
        errors["details"] = "Details must be 1,000 characters or fewer"
    if errors:
        raise MelaError(422, errors=errors)
    return reason, details
