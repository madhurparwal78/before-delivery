"""The editable-field list, its field rules and the clearance void.

A create or an edit writes only these keys. Every other key in the body is
ignored, whatever it holds.
"""

from __future__ import annotations

import datetime as dt
import re

from ..config import MAX_FIGURES

TEXT_FIELDS = ("title", "summary", "challenge", "work", "sector", "customer")
NULLABLE_FIELDS = ("quote", "quote_speaker", "quote_role", "title_fi", "body_fi")
EDITABLE = TEXT_FIELDS + ("figures",) + NULLABLE_FIELDS
REQUIRED_ON_CREATE = ("title", "sector", "customer", "summary", "challenge", "work")
CLEARANCE_COVERS = ("figures", "quote", "quote_speaker", "quote_role", "customer")

SECTOR = re.compile(r"^[a-z][a-z-]*$")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
STAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$")

HOSTILE = "This value holds characters the desk cannot store"
BLANK = "This field cannot be empty"


def is_hostile(text: str) -> bool:
    return "\x00" in text or any(0xD800 <= ord(char) <= 0xDFFF for char in text)


def _plain(value, limit: int | None) -> str | None:
    """A field message, or None when the value is an acceptable non-empty string."""
    if not isinstance(value, str):
        return "Send this field as text"
    if is_hostile(value):
        return HOSTILE
    if not value.strip():
        return BLANK
    if limit is not None and len(value) > limit:
        return f"Keep this field to {limit} characters or fewer"
    return None


def _figures(value) -> tuple[list[dict] | None, str | None]:
    if not isinstance(value, list):
        return None, "Send the figures as a list"
    if not 1 <= len(value) <= MAX_FIGURES:
        return None, f"Record between 1 and {MAX_FIGURES} result figures"
    cleaned = []
    for item in value:
        if not isinstance(item, dict):
            return None, "Each figure needs a label and a value"
        label, figure_value = item.get("label"), item.get("value")
        for part in (label, figure_value):
            if not isinstance(part, str):
                return None, "Each figure needs a label and a value"
            if is_hostile(part):
                return None, HOSTILE
            if not part.strip():
                return None, "Each figure needs a label and a value"
        cleaned.append({"label": label, "value": figure_value})
    return cleaned, None


def validate(body: dict, *, creating: bool) -> tuple[dict, dict]:
    """The editable fields of this body, and a message for each refused field."""
    clean: dict = {}
    errors: dict = {}

    for name in TEXT_FIELDS:
        if name not in body:
            continue
        limit = 120 if name in ("title", "customer") else (40 if name == "sector" else None)
        message = _plain(body[name], limit)
        if message is None and name == "sector" and not SECTOR.match(body[name]):
            message = "Use lowercase letters and hyphens, starting with a letter"
        if message is None:
            clean[name] = body[name]
        else:
            errors[name] = message

    for name in NULLABLE_FIELDS:
        if name not in body:
            continue
        value = body[name]
        if value is None:
            clean[name] = None
        elif not isinstance(value, str):
            errors[name] = "Send this field as text or null"
        elif is_hostile(value):
            errors[name] = HOSTILE
        else:
            clean[name] = value or None

    if "figures" in body:
        figures, message = _figures(body["figures"])
        if message is None:
            clean["figures"] = figures
        else:
            errors["figures"] = message

    if creating:
        for name in REQUIRED_ON_CREATE:
            if name not in body and name not in errors:
                errors[name] = "This field is required"

    return clean, errors


def parse_window_date(value) -> tuple[dt.date | None, str | None]:
    if not isinstance(value, str):
        return None, "Send the date as text in the form YYYY-MM-DD"
    if is_hostile(value):
        return None, HOSTILE
    if not DATE.match(value):
        return None, "Write the date in the form YYYY-MM-DD"
    try:
        return dt.date(int(value[0:4]), int(value[5:7]), int(value[8:10])), None
    except ValueError:
        return None, "That is not a real date"


def parse_stamp(value) -> tuple[dt.datetime | None, str | None]:
    if not isinstance(value, str):
        return None, "Send the expiry as text with a time zone offset"
    if is_hostile(value):
        return None, HOSTILE
    if not STAMP.match(value):
        return None, "Write the expiry as YYYY-MM-DDThh:mm:ss with Z or an offset"
    try:
        return dt.datetime.fromisoformat(value.replace("Z", "+00:00")), None
    except ValueError:
        return None, "That is not a real moment in time"


def voids_clearance(row, clean: dict, stored_figures: list[dict]) -> bool:
    """True when this edit changes content the customer cleared."""
    if row["clearance_from"] is None and row["clearance_until"] is None:
        return False
    for name in CLEARANCE_COVERS:
        if name not in clean:
            continue
        if name == "figures":
            if clean["figures"] != stored_figures:
                return True
        elif clean[name] != row[name]:
            return True
    return False


def changes(row, clean: dict, stored_figures: list[dict]) -> dict:
    """The subset of this edit that actually changes the stored reference."""
    different = {}
    for name, value in clean.items():
        stored = stored_figures if name == "figures" else row[name]
        if value != stored:
            different[name] = value
    return different
