"""Domain rules of the Northfall Reference Desk.

Each rule named in the brief lives in exactly one place here and is used by
every surface that needs it: the service clock and the reading of now, the
Helsinki date, the clearance window, the live-set rule, the reference state,
the ordinal run and its rollover, the slug derivation and its history, the
role check, the clearance void, the editable-field list and the Finnish
string table.
"""

from __future__ import annotations

import datetime as dt
import re
import unicodedata
from zoneinfo import ZoneInfo

HELSINKI = ZoneInfo("Europe/Helsinki")
SESSION_SECONDS = 8 * 3600
PREVIEW_DEFAULT_SECONDS = 7 * 86400
PREVIEW_MAX_SECONDS = 30 * 86400
BODY_MAX_BYTES = 65536

DRAFT, LIVE, WITHHELD, RETIRED = "draft", "live", "withheld", "retired"

SECTOR_RE = re.compile(r"^[a-z][a-z-]{0,39}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]+$")
TOKEN_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"

# The editable fields: the only keys a create or edit writes.
EDITABLE_SCALARS = ("title", "summary", "challenge", "work", "sector",
                    "customer", "quote", "quote_speaker", "quote_role",
                    "title_fi", "body_fi")
EDITABLE = EDITABLE_SCALARS + ("figures",)


# ---------------------------------------------------------------- the clock

def helsinki_date(now: dt.datetime) -> dt.date:
    """The calendar date of an instant in Helsinki, DST counted as one date."""
    return now.astimezone(HELSINKI).date()


# ------------------------------------------------------- clearance windows

def parse_date(value) -> dt.date | None:
    """A window date must be exactly YYYY-MM-DD and a real date."""
    if not isinstance(value, str) or not DATE_RE.match(value):
        return None
    try:
        return dt.date.fromisoformat(value)
    except ValueError:
        return None


def window_contains(today: dt.date, ref: dict) -> bool:
    """Both window dates are inclusive."""
    start, until = ref.get("clearance_from"), ref.get("clearance_until")
    if start is None or until is None:
        return False
    return start <= today and today <= until


# ------------------------------------------------------------ live set

def state_of(ref: dict, today: dt.date) -> str:
    """One place decides the state word of a reference."""
    if ref["published"] and ref["retired_at"] is None:
        return LIVE if window_contains(today, ref) else WITHHELD
    if ref["retired_at"] is not None:
        return RETIRED
    return DRAFT


# ----------------------------------------------------------- the ordinal run

def finnish_key(title: str, slug: str) -> tuple:
    order = {c: i for i, c in enumerate("abcdefghijklmnopqrstuvwxyz")}
    def rank(ch: str) -> tuple:
        if ch in order:
            return (2, order[ch], "")
        if ch in ("å", "ä", "ö"):
            return (3, "åäö".index(ch), "")
        return (1, ord(ch), "")
    text = unicodedata.normalize("NFKC", title).lower()
    key = tuple(rank(ch) for ch in text)
    return (key, unicodedata.normalize("NFKC", slug).lower())


# --------------------------------------------------------- slugs and history

def slugify(title: str) -> str:
    """The title is slugged in composed form; a title that leaves nothing
    yields no slug and the caller refuses the write."""
    composed = unicodedata.normalize("NFKC", title)
    composed = composed.casefold()
    table = str.maketrans({"ä": "a", "å": "a", "ö": "o",
                           "ß": "s", "ø": "o", "æ": "a", "œ": "o"})
    composed = composed.translate(table)
    parts = re.split(r"[^0-9a-z]+", composed)
    slug = "-".join(p for p in parts if p)
    return slug.strip("-")


def slug_unique(base: str, taken: set[str], own_earlier: set[str],
                current: str | None = None) -> tuple[str, str | None]:
    """Return (slug, recovered_history_slug).

    A clash takes the lowest free suffix starting at -2. The exception is a
    rename back to one of the reference's own earlier slugs, which takes that
    slug back and drops that history entry. That slug is reserved in history
    for this reference, so no other reference can hold it.
    """
    if base in own_earlier:
        own_earlier.discard(base)
        return base, base
    free = taken - {current} if current else taken
    if base not in free:
        return base, None
    suffix = 2
    while f"{base}-{suffix}" in free:
        suffix += 1
    return f"{base}-{suffix}", None


