"""Field limits, the counting rule, the unsupported-character rule and the option lists.

Every check of applicant, note and sign-in text is decided here and nowhere else.
"""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass
from typing import Any

# Unicode White_Space, the only characters trimming removes.
WHITE_SPACE = (
    "\t\n\x0b\x0c\r \x85\xa0 "
    + "".join(chr(code) for code in range(0x2000, 0x200B))
    + "    　"
)

TEXT_LIMITS: dict[str, int] = {
    "first_name": 80,
    "last_name": 80,
    "work_email": 254,
    "job_title": 120,
    "company_name": 160,
    "website": 2048,
    "goals": 2000,
}
NOTE_LIMIT = 1000

COMPANY_TYPES = (
    "SaaS or Technology Platform", "IT Services or MSP or VAR", "Systems Integrator", "Consultant or Agency",
    "Marketplace or Distributor", "Community or Association", "Content or Affiliate Publisher", "Other",
)
EMPLOYEE_BANDS = ("1 to 9", "10 to 25", "26 to 100", "101 to 500", "501 to 1000", "1001 to 5000", "5001 plus")
MARKETS = ("North America", "EMEA", "APAC", "LATAM", "Global")
CUSTOMER_SEGMENTS = ("SMB", "Mid-Market", "Enterprise", "Education", "Government or Public Sector", "Other")
PARTNERSHIP_INTERESTS = (
    "build an integration", "refer customers", "resell", "bundle into a product or service",
    "offer through a marketplace or distribution channel", "support customer implementation or adoption",
    "offer to members or community", "explore co-marketing or co-selling", "not sure yet", "other",
)
OPTION_FIELDS: dict[str, tuple[str, ...]] = {
    "company_type": COMPANY_TYPES,
    "employee_band": EMPLOYEE_BANDS,
    "customer_segment": CUSTOMER_SEGMENTS,
}
LIST_FIELDS: dict[str, tuple[str, ...]] = {
    "markets": MARKETS,
    "partnership_interests": PARTNERSHIP_INTERESTS,
}
APPLICATION_FIELDS = (
    "first_name", "last_name", "work_email", "job_title", "company_name", "website", "company_type",
    "employee_band", "markets", "customer_segment", "partnership_interests", "goals", "consent",
)

MSG_REQUIRED = "This field is required."
MSG_CONSENT = "You must give consent to apply."
MSG_UNSUPPORTED = "Remove unsupported characters from this field."
MSG_EMAIL = "Enter a valid work email address."
MSG_WEBSITE = "Enter a URL starting with http:// or https://."
MSG_OPTION = "Choose one of the listed options."
MSG_DECISION = "Choose approve or reject."
MSG_NOTE_TEXT = "Enter the note as text."
SUMMARY_MESSAGE = "Please correct the fields below."


def limit_message(limit: int) -> str:
    return f"Must be at most {limit} characters."


def normalised(value: str) -> str:
    """The counting and storage form: NFC, then trimmed of White_Space at both ends."""
    return unicodedata.normalize("NFC", value).strip(WHITE_SPACE)


def length(value: str) -> int:
    return len(normalised(value))


def has_unsupported(value: str) -> bool:
    for char in value:
        code = ord(char)
        if (code < 0x20 and char not in "\t\n\r") or code == 0x7F or 0xD800 <= code <= 0xDFFF:
            return True
    return False


def email_key(value: str) -> str:
    """Stored work-email form, also the sign-in failure key: trimmed NFC, Unicode lower case."""
    return normalised(value).lower()


def _malformed_email(value: str) -> bool:
    local, at, domain = value.partition("@")
    return (not at or "@" in domain or not local or "." not in domain
            or any(char in WHITE_SPACE for char in value))


def _malformed_website(value: str) -> bool:
    return not value.startswith(("http://", "https://")) or any(char in WHITE_SPACE for char in value)


MALFORMED_TEXT = {"work_email": (_malformed_email, MSG_EMAIL), "website": (_malformed_website, MSG_WEBSITE)}


def _text_message(name: str, value: Any, limit: int) -> str | None:
    if not isinstance(value, str) or not normalised(value):
        return MSG_REQUIRED
    if length(value) > limit:
        return limit_message(limit)
    if has_unsupported(value):
        return MSG_UNSUPPORTED
    malformed = MALFORMED_TEXT.get(name)
    if malformed and malformed[0](normalised(value)):
        return malformed[1]
    return None


def _option_message(value: Any, options: tuple[str, ...]) -> str | None:
    if not isinstance(value, str) or not value.strip(WHITE_SPACE):
        return MSG_REQUIRED
    return None if value in options else MSG_OPTION


def _list_message(value: Any, options: tuple[str, ...]) -> str | None:
    if not isinstance(value, list) or not value:
        return MSG_REQUIRED
    if any(not isinstance(entry, str) or entry not in options for entry in value) or len(set(value)) != len(value):
        return MSG_OPTION
    return None


@dataclass(frozen=True, slots=True)
class CleanApplication:
    first_name: str
    last_name: str
    work_email: str
    job_title: str
    company_name: str
    website: str
    company_type: str
    employee_band: str
    markets: list[str]
    customer_segment: str
    partnership_interests: list[str]
    goals: str


def check_application(body: dict[str, Any]) -> tuple[dict[str, str], CleanApplication | None]:
    """Return every failing field's one message, or the stored form of the thirteen fields."""
    errors: dict[str, str] = {}
    for name, limit in TEXT_LIMITS.items():
        if message := _text_message(name, body.get(name), limit):
            errors[name] = message
    for name, options in OPTION_FIELDS.items():
        if message := _option_message(body.get(name), options):
            errors[name] = message
    for name, options in LIST_FIELDS.items():
        if message := _list_message(body.get(name), options):
            errors[name] = message
    if body.get("consent") is not True:
        errors["consent"] = MSG_CONSENT
    if errors:
        return {name: errors[name] for name in APPLICATION_FIELDS if name in errors}, None
    texts = {name: normalised(body[name]) for name in TEXT_LIMITS}
    texts["work_email"] = email_key(body["work_email"])
    return {}, CleanApplication(
        **texts,
        company_type=body["company_type"],
        employee_band=body["employee_band"],
        markets=list(body["markets"]),
        customer_segment=body["customer_segment"],
        partnership_interests=list(body["partnership_interests"]),
    )


def sent_values(body: dict[str, Any]) -> dict[str, Any]:
    """The `values` echo: all thirteen fields exactly as sent, null when omitted."""
    return {name: body.get(name) for name in APPLICATION_FIELDS}


def check_decision(body: dict[str, Any]) -> tuple[dict[str, str], str | None]:
    """Validate a decision body; return errors, or the stored note (None when absent or blank)."""
    errors: dict[str, str] = {}
    if body.get("decision") not in ("approve", "reject"):
        errors["decision"] = MSG_DECISION
    note = body.get("note")
    if note is not None and not isinstance(note, str):
        errors["note"] = MSG_NOTE_TEXT
    elif isinstance(note, str):
        if length(note) > NOTE_LIMIT:
            errors["note"] = limit_message(NOTE_LIMIT)
        elif has_unsupported(note):
            errors["note"] = MSG_UNSUPPORTED
    if errors:
        return errors, None
    return {}, (normalised(note) or None) if isinstance(note, str) else None


def check_credentials(body: dict[str, Any]) -> dict[str, str]:
    return {name: MSG_REQUIRED for name in ("email", "password") if not isinstance(body.get(name), str)}


def client_rules() -> dict[str, Any]:
    """The values the partner page's goals counter and the review page's email key reuse."""
    return {"whiteSpace": WHITE_SPACE, "limits": TEXT_LIMITS, "noteLimit": NOTE_LIMIT}
