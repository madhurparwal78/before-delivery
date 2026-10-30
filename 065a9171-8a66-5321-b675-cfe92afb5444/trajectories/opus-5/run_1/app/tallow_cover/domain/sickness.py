"""Sickness records, the seven-day fit-note rule and fit-note file checks."""

from __future__ import annotations

from datetime import date

from ..timeutil import days_inclusive

FIT_NOTE_AFTER_DAYS = 7
MAX_FIT_NOTE_BYTES = 5_000_000
MAX_BACKDATED_DAYS = 28

STATUS_LABELS = {
    "reported": "Reported",
    "fit_note_required": "Fit note required",
    "evidenced": "Evidenced",
    "closed": "Closed",
}


def span_days(record: dict, today: date) -> int:
    """From the first day off sick to the last sick day, or today while still open."""
    last = record["last_sick_date"] or today
    return days_inclusive(record["start_date"], last)


def needs_fit_note(record: dict, today: date) -> bool:
    return record["status"] == "reported" and span_days(record, today) > FIT_NOTE_AFTER_DAYS


def detect_file_type(content: bytes) -> str | None:
    """The file's type is judged by its bytes, never by its name or declared type."""
    if content.startswith(b"%PDF-") and b"%%EOF" in content:
        return "application/pdf"
    if content.startswith(b"\xff\xd8\xff") and content.endswith(b"\xff\xd9"):
        return "image/jpeg"
    if content.startswith(b"\x89PNG\r\n\x1a\n") and b"IEND" in content:
        return "image/png"
    return None


EXTENSIONS = {"application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png"}


def safe_file_name(raw: str) -> str:
    """The last path segment, without control characters, cut to 100 characters."""
    segment = raw.replace("\\", "/").rsplit("/", 1)[-1]
    cleaned = "".join(character for character in segment if character.isprintable())
    return cleaned[:100]
