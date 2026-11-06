"""Partner application and decision validation, including the option lists."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .jsonbody import json_safe
from .textrules import (
    contains_white_space,
    count_code_points,
    email_key,
    has_unsupported_characters,
    normalise,
)

COMPANY_TYPES = (
    "SaaS or Technology Platform",
    "IT Services or MSP or VAR",
    "Systems Integrator",
    "Consultant or Agency",
    "Marketplace or Distributor",
    "Community or Association",
    "Content or Affiliate Publisher",
    "Other",
)

EMPLOYEE_BANDS = (
    "1 to 9",
    "10 to 25",
    "26 to 100",
    "101 to 500",
    "501 to 1000",
    "1001 to 5000",
    "5001 plus",
)

MARKETS = ("North America", "EMEA", "APAC", "LATAM", "Global")

CUSTOMER_SEGMENTS = (
    "SMB",
    "Mid-Market",
    "Enterprise",
    "Education",
    "Government or Public Sector",
    "Other",
)

PARTNERSHIP_INTERESTS = (
    "build an integration",
    "refer customers",
    "resell",
    "bundle into a product or service",
    "offer through a marketplace or distribution channel",
    "support customer implementation or adoption",
    "offer to members or community",
    "explore co-marketing or co-selling",
    "not sure yet",
    "other",
)

TEXT_LIMITS = {
    "first_name": 80,
    "last_name": 80,
    "work_email": 254,
    "job_title": 120,
    "company_name": 160,
    "website": 2048,
    "goals": 2000,
}

NOTE_LIMIT = 1000

APPLICATION_FIELDS = (
    "first_name",
    "last_name",
    "work_email",
    "job_title",
    "company_name",
    "website",
    "company_type",
    "employee_band",
    "markets",
    "customer_segment",
    "partnership_interests",
    "goals",
    "consent",
)

REQUIRED_MESSAGE = "This field is required."
CONSENT_MESSAGE = "You must give consent to apply."
UNSUPPORTED_MESSAGE = "Remove unsupported characters from this field."
OPTION_MESSAGE = "Choose one of the listed options."
EMAIL_MESSAGE = "Enter a valid work email address."
WEBSITE_MESSAGE = "Enter a URL starting with http:// or https://."
DECISION_MESSAGE = "Choose approve or reject."
NOTE_TYPE_MESSAGE = "Enter the note as text."

_OPTION_FIELDS = {
    "company_type": COMPANY_TYPES,
    "employee_band": EMPLOYEE_BANDS,
    "customer_segment": CUSTOMER_SEGMENTS,
}

_LIST_FIELDS = {
    "markets": MARKETS,
    "partnership_interests": PARTNERSHIP_INTERESTS,
}


def limit_message(limit: int) -> str:
    return f"Must be at most {limit} characters."


@dataclass
class ApplicationDraft:
    """A validated application, ready to store."""

    values: dict[str, Any]


def _text_field_message(name: str, raw: Any) -> str | None:
    limit = TEXT_LIMITS[name]
    if not isinstance(raw, str) or normalise(raw) == "":
        return REQUIRED_MESSAGE
    if count_code_points(raw) > limit:
        return limit_message(limit)
    if has_unsupported_characters(raw):
        return UNSUPPORTED_MESSAGE
    value = normalise(raw)
    if name == "work_email" and not _is_work_email(value):
        return EMAIL_MESSAGE
    if name == "website" and not _is_website(value):
        return WEBSITE_MESSAGE
    return None


def _is_work_email(value: str) -> bool:
    if value.count("@") != 1 or contains_white_space(value):
        return False
    local, _, domain = value.partition("@")
    return bool(local) and "." in domain


def _is_website(value: str) -> bool:
    if contains_white_space(value):
        return False
    return value.startswith("http://") or value.startswith("https://")


def _option_field_message(raw: Any, options: tuple[str, ...]) -> str | None:
    if not isinstance(raw, str) or normalise(raw) == "":
        return REQUIRED_MESSAGE
    if raw not in options:
        return OPTION_MESSAGE
    return None


def _list_field_message(raw: Any, options: tuple[str, ...]) -> str | None:
    if not isinstance(raw, list) or not raw:
        return REQUIRED_MESSAGE
    seen: set[str] = set()
    for entry in raw:
        if not isinstance(entry, str) or entry not in options or entry in seen:
            return OPTION_MESSAGE
        seen.add(entry)
    return None


def validate_application(body: dict[str, Any]) -> tuple[dict[str, str], dict[str, Any], ApplicationDraft | None]:
    """Validate a create body; returns (errors, echoed values, draft)."""
    errors: dict[str, str] = {}
    echoed = {name: json_safe(body.get(name)) for name in APPLICATION_FIELDS}

    for name in TEXT_LIMITS:
        message = _text_field_message(name, body.get(name))
        if message is not None:
            errors[name] = message

    for name, options in _OPTION_FIELDS.items():
        message = _option_field_message(body.get(name), options)
        if message is not None:
            errors[name] = message

    for name, options in _LIST_FIELDS.items():
        message = _list_field_message(body.get(name), options)
        if message is not None:
            errors[name] = message

    if body.get("consent") is not True:
        errors["consent"] = CONSENT_MESSAGE

    ordered = {name: errors[name] for name in APPLICATION_FIELDS if name in errors}
    if ordered:
        return ordered, echoed, None

    stored: dict[str, Any] = {name: normalise(body[name]) for name in TEXT_LIMITS}
    stored["work_email"] = email_key(body["work_email"])
    for name in _OPTION_FIELDS:
        stored[name] = body[name]
    for name in _LIST_FIELDS:
        stored[name] = list(body[name])
    stored["consent"] = True
    return {}, echoed, ApplicationDraft(values=stored)


def validate_decision(body: dict[str, Any]) -> tuple[dict[str, str], str | None, str | None]:
    """Validate a decision body; returns (errors, decision, stored note)."""
    errors: dict[str, str] = {}
    decision = body.get("decision")
    if not isinstance(decision, str) or decision not in ("approve", "reject"):
        errors["decision"] = DECISION_MESSAGE

    raw_note = body.get("note")
    stored_note: str | None = None
    if raw_note is not None:
        if not isinstance(raw_note, str):
            errors["note"] = NOTE_TYPE_MESSAGE
        elif count_code_points(raw_note) > NOTE_LIMIT:
            errors["note"] = limit_message(NOTE_LIMIT)
        elif has_unsupported_characters(raw_note):
            errors["note"] = UNSUPPORTED_MESSAGE
        else:
            stored_note = normalise(raw_note) or None

    if errors:
        ordered = {name: errors[name] for name in ("decision", "note") if name in errors}
        return ordered, None, None
    return {}, decision, stored_note
