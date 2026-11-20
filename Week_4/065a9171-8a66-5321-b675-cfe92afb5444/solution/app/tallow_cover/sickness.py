"""Sickness rules: the seven-day fit-note rule, the return rule and fit-note file checks."""

import re

import asyncpg

from . import shifts

FIT_NOTE_AFTER_DAYS = 7
FIT_NOTE_MAX_BYTES = 5_000_000
STATUS_LABELS = {"reported": "Reported", "fit_note_required": "Fit note required", "evidenced": "Evidenced",
                 "closed": "Closed"}
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


async def require_fit_notes(conn: asyncpg.Connection, person_id: str | None = None,
                            record_id: str | None = None) -> None:
    """A reported record spanning more than seven calendar days (to today, while open) needs a fit note."""
    await conn.execute(
        "UPDATE sickness SET status = 'fit_note_required' WHERE status = 'reported' AND last_sick_date IS NULL"
        " AND $1::date - start_date + 1 > $2 AND ($3::text IS NULL OR person_id = $3) AND ($4::text IS NULL OR id = $4)",
        shifts.today(), FIT_NOTE_AFTER_DAYS, person_id, record_id)


def can_close(status: str, span_days: int) -> bool:
    """From evidenced the return always closes; otherwise only a span of seven days or fewer."""
    return status == "evidenced" or span_days <= FIT_NOTE_AFTER_DAYS


def fit_note_kind(data: bytes) -> tuple[str, str] | None:
    """(extension, content type) judged by the bytes alone, never by name or declared type."""
    if data.startswith(b"%PDF-") and b"%%EOF" in data:
        return "pdf", "application/pdf"
    if data.startswith(b"\xff\xd8\xff") and data.endswith(b"\xff\xd9"):
        return "jpg", "image/jpeg"
    if data.startswith(PNG_SIGNATURE) and b"IEND" in data:
        return "png", "image/png"
    return None


def file_name(original: str) -> str:
    """The last path segment after any / or \\, without control characters, cut to 100 characters."""
    return re.sub(r"[\x00-\x1f\x7f]", "", re.split(r"[/\\]", original)[-1])[:100]
