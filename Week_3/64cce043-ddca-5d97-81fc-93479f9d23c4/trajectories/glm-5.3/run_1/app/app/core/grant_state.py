"""The grant status computation, decided in this one place."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional, Sequence


@dataclass(frozen=True)
class GrantView:
    id: str
    status_word: str  # stored end-state: revoked, or the raw state
    ends_at: Optional[datetime]
    revoked: bool
    levels: tuple[str, ...]
    contact_name: str
    contact_email: str
    duration: str
    created_at: datetime


def grant_status(grant: GrantView, db_now: datetime) -> tuple[str, int]:
    """Return (status, remaining_seconds) decided by the database clock.

    Status: revoked once revoked, otherwise expired at or after ends_at
    (the end instant counts as ended), otherwise active. remaining_seconds is
    the whole seconds from now to ends_at, rounded down, 0 unless active.
    """
    if grant.revoked:
        return "revoked", 0
    ends = grant.ends_at
    if ends is None:
        return "active", 0
    ends = ends.astimezone(timezone.utc)
    now = db_now.astimezone(timezone.utc)
    if now >= ends:
        return "expired", 0
    remaining = int((ends - now).total_seconds())
    return "active", remaining


def is_active(status: str) -> bool:
    return status == "active"


def grant_levels(grant: GrantView) -> Sequence[str]:
    return grant.levels
