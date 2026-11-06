"""Domain rules for partner applications. Each rule lives in exactly one place
and is reused wherever it applies."""
from __future__ import annotations

import unicodedata
from typing import Any, Iterable

WHITE_SPACE = (
    "\t\n\v\f\r"  # U+0009..U+000D
    "\x1c\x1d\x1e\x1f"  # U+001C..U+001F
    " \x85\xa0\u1680"
    "\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a"
    "\u2028\u2029\u202f\u205f\u3000"
)
_WHITE_SPACE_SET = frozenset(WHITE_SPACE)

OPTION_COMPANY_TYPES = [
    "SaaS or Technology Platform",
    "IT Services or MSP or VAR",
    "Systems Integrator",
    "Consultant or Agency",
    "Marketplace or Distributor",
    "Community or Association",
    "Content or Affiliate Publisher",
    "Other",
]
OPTION_EMPLOYEE_BANDS = [
    "1 to 9",
    "10 to 25",
    "26 to 100",
    "101 to 500",
    "501 to 1000",
    "1001 to 5000",
    "5001 plus",
]
OPTION_MARKETS = ["North America", "EMEA", "APAC", "LATAM", "Global"]
OPTION_CUSTOMER_SEGMENTS = [
    "SMB",
    "Mid-Market",
    "Enterprise",
    "Education",
    "Government or Public Sector",
    "Other",
]
OPTION_PARTNERSHIP_INTERESTS = [
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
]

TEXT_FIELDS: dict[str, int] = {
    "first_name": 80,
    "last_name": 80,
    "work_email": 254,
    "job_title": 120,
    "company_name": 160,
    "website": 2048,
    "goals": 2000,
}
FIELD_ORDER = [
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
]
CONSENT_LABEL = "I consent to Relayo contacting me about this application."
DECISION_NOTE_LIMIT = 1000

MSG_REQUIRED = "This field is required."
MSG_CONSENT = "You must give consent to apply."
MSG_OPTION = "Choose one of the listed options."
MSG_EMAIL_MALFORMED = "Enter a valid work email address."
MSG_WEBSITE_MALFORMED = "Enter a URL starting with http:// or https://."
MSG_DECISION = "Choose approve or reject."
MSG_NOTE_TYPE = "Enter the note as text."


def is_white_space(ch: str) -> bool:
    return ch in _WHITE_SPACE_SET


def trim(value: str) -> str:
    """Trim only Unicode white space from both ends (Business rules rule 2)."""
    start = 0
    end = len(value)
    while start < end and value[start] in _WHITE_SPACE_SET:
        start += 1
    while end > start and value[end - 1] in _WHITE_SPACE_SET:
        end -= 1
    return value[start:end]


def normalise(value: str) -> str:
    """Trim of Unicode white space only, then NFC-normalised."""
    return unicodedata.normalize("NFC", trim(value))


def length(value: str) -> int:
    """Code points after NFC normalisation and trimming (counting rule)."""
    return len(normalise(value))


def work_email_key(raw: str) -> str:
    """Stored work email / sign-in email key: trimmed, NFC, default lowercase."""
    return normalise(raw).lower()


def has_unpaired_surrogate(value: str) -> bool:
    index = 0
    while index < len(value):
        code = ord(value[index])
        if 0xD800 <= code <= 0xDFFF:
            if 0xDC00 <= code <= 0xDFFF:
                if index == 0 or not (
                    0xD800 <= ord(value[index - 1]) <= 0xDBFF
                ):
                    return True
                index += 1
            elif index + 1 >= len(value) or not (
                0xDC00 <= ord(value[index + 1]) <= 0xDFFF
            ):
                return True
        index += 1
    return False


def unsupported_characters(value: str) -> bool:
    """True when the value as sent carries unsupported characters."""
    for ch in value:
        code = ord(ch)
        if code <= 0x1F and ch not in "\t\n\r":
            return True
        if code == 0x7F:
            return True
    return has_unpaired_surrogate(value)


def _is_missing(value: Any) -> bool:
    return not isinstance(value, str) or normalise(value) == ""


def _text_error(field: str, raw: str) -> str | None:
    """Message priority: missing, limit, unsupported, malformed."""
    if _is_missing(raw):
        return MSG_REQUIRED
    if length(raw) > TEXT_FIELDS[field]:
        return f"Must be at most {TEXT_FIELDS[field]} characters."
    if unsupported_characters(raw):
        return "Remove unsupported characters from this field."
    value = normalise(raw)
    if field == "work_email" and not _email_ok(value):
        return MSG_EMAIL_MALFORMED
    if field == "website" and not _website_ok(value):
        return MSG_WEBSITE_MALFORMED
    return None


def _email_ok(value: str) -> bool:
    if value.count("@") != 1:
        return False
    local, domain = value.split("@")
    return bool(local) and "." in domain and not any(
        ch in _WHITE_SPACE_SET for ch in value
    )


def _website_ok(value: str) -> bool:
    return value.startswith(("http://", "https://")) and not any(
        ch in _WHITE_SPACE_SET for ch in value
    )


def validate_application(body: Any) -> dict[str, str]:
    """Return the errors map for a create body (field order preserved)."""
    errors: dict[str, str] = {}
    if not isinstance(body, dict):
        return {field: MSG_REQUIRED for field in FIELD_ORDER}
    for field in FIELD_ORDER:
        raw = body.get(field)
        if field in TEXT_FIELDS:
            message = _text_error(field, raw)
            if message:
                errors[field] = message
        elif field in ("company_type", "employee_band", "customer_segment"):
            if not isinstance(raw, str) or trim(raw) == "":
                errors[field] = MSG_REQUIRED
            elif raw not in _option_for(field):
                errors[field] = MSG_OPTION
        elif field in ("markets", "partnership_interests"):
            if not isinstance(raw, list) or not raw:
                errors[field] = MSG_REQUIRED
            elif not all(
                isinstance(entry, str) and entry in _option_for(field)
                for entry in raw
            ):
                errors[field] = MSG_OPTION
            elif len(set(raw)) != len(raw):
                errors[field] = MSG_OPTION
        elif field == "consent":
            if raw is not True:
                errors[field] = MSG_CONSENT
    return errors


def _option_for(field: str) -> Iterable[str]:
    if field == "company_type":
        return OPTION_COMPANY_TYPES
    if field == "employee_band":
        return OPTION_EMPLOYEE_BANDS
    if field == "customer_segment":
        return OPTION_CUSTOMER_SEGMENTS
    if field == "markets":
        return OPTION_MARKETS
    return OPTION_PARTNERSHIP_INTERESTS


def stored_fields(body: dict[str, Any]) -> dict[str, Any]:
    """The thirteen stored values for a validated create body."""
    return {
        "first_name": normalise(body["first_name"]),
        "last_name": normalise(body["last_name"]),
        "work_email": work_email_key(body["work_email"]),
        "job_title": normalise(body["job_title"]),
        "company_name": normalise(body["company_name"]),
        "website": normalise(body["website"]),
        "company_type": body["company_type"],
        "employee_band": body["employee_band"],
        "markets": body["markets"],
        "customer_segment": body["customer_segment"],
        "partnership_interests": body["partnership_interests"],
        "goals": normalise(body["goals"]),
        "consent": True,
    }


def validate_decision(body: Any) -> dict[str, str]:
    errors: dict[str, str] = {}
    if not isinstance(body, dict):
        return {"decision": MSG_DECISION}
    decision = body.get("decision")
    if decision not in ("approve", "reject"):
        errors["decision"] = MSG_DECISION
    note = body.get("note")
    if note is not None:
        if not isinstance(note, str):
            errors["note"] = MSG_NOTE_TYPE
        else:
            if length(note) > DECISION_NOTE_LIMIT:
                errors["note"] = (
                    f"Must be at most {DECISION_NOTE_LIMIT} characters."
                )
            elif unsupported_characters(note):
                errors["note"] = "Remove unsupported characters from this field."
    return errors


def stored_note(body: dict[str, Any]) -> str | None:
    note = body.get("note")
    if not isinstance(note, str):
        return None
    value = normalise(note)
    return value if value else None
