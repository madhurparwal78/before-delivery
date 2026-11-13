"""Preview links: minting, replacement and elapsed-time expiry."""

from __future__ import annotations

import datetime as dt
import secrets

from ..config import PREVIEW_DEFAULT_SECONDS, PREVIEW_MAX_SECONDS
from .fields import is_hostile
from .references import by_id


def _token(slug: str) -> str:
    while True:
        token = secrets.token_urlsafe(32)
        if slug not in token:
            return token


def retire_links(conn, reference_id: int) -> None:
    conn.execute(
        "UPDATE preview_link SET retired = true WHERE reference_id = %s AND NOT retired",
        (reference_id,),
    )


def check_expiry(expires_at: dt.datetime, now: dt.datetime) -> str | None:
    elapsed = (expires_at - now).total_seconds()
    if elapsed <= 0:
        return "Set an expiry later than now"
    if elapsed > PREVIEW_MAX_SECONDS:
        return "Set an expiry no more than 30 days from now"
    return None


def mint(conn, reference: dict, now: dt.datetime, expires_at: dt.datetime | None) -> dict:
    """A new link for this reference, retiring every earlier link for it."""
    if expires_at is None:
        expires_at = now + dt.timedelta(seconds=PREVIEW_DEFAULT_SECONDS)
    retire_links(conn, reference["id"])
    token = _token(reference["slug"])
    conn.execute(
        "INSERT INTO preview_link (token, reference_id, expires_at) VALUES (%s, %s, %s)",
        (token, reference["id"], expires_at),
    )
    return {"token": token, "expires_at": expires_at}


def resolve(conn, programme_id: int, slug: str, token: str, now: dt.datetime) -> dict | None:
    """The reference this link opens, or None for every refused preview.

    A link is valid at its expiry second and refused one second later, and it
    belongs to its reference rather than to a slug.
    """
    if is_hostile(token):
        return None
    row = conn.execute(
        "SELECT reference_id, expires_at FROM preview_link WHERE token = %s AND NOT retired",
        (token,),
    ).fetchone()
    if row is None or row["expires_at"] < now:
        return None
    reference = by_id(conn, int(row["reference_id"]))
    if reference is None or reference["programme_id"] != programme_id:
        return None
    if reference["slug"] != slug:
        return None
    return reference
