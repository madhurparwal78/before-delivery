"""Consecutive-failure locks, measured on the database clock.

Both the sign-in throttle and the wrong-flag lock count failures since the
latest success or the end of the latest lock, whichever is later.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta


def lock_end(
    attempts: list[tuple[bool, datetime]], limit: int, lock_seconds: int
) -> datetime | None:
    """The end of the lock the stored attempts (oldest first) have earned."""
    count = 0
    ends_at: datetime | None = None
    for succeeded, created_at in attempts:
        if ends_at is not None and created_at >= ends_at:
            count, ends_at = 0, None
        if succeeded:
            count, ends_at = 0, None
            continue
        count += 1
        if count >= limit:
            ends_at = created_at + timedelta(seconds=lock_seconds)
    return ends_at


def seconds_remaining(ends_at: datetime | None, now: datetime, cap: int) -> int | None:
    """Seconds left on a lock, rounded up, or None when it is not locked."""
    if ends_at is None or now >= ends_at:
        return None
    return max(1, min(cap, math.ceil((ends_at - now).total_seconds())))
