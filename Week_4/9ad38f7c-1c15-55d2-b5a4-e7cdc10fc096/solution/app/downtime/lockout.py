"""Failure-streak locks measured on the database clock, shared by the sign-in throttle and the wrong-flag lock."""

import math
from datetime import datetime, timedelta


def seconds_left(failures: list[datetime], now: datetime, limit: int, lock_seconds: int) -> int:
    """Seconds left (rounded up, at least 1) on the lock a streak of stored failures holds, or 0 when unlocked.

    `failures` are the stored failures since the latest success, oldest first. The `limit`-th failure in a row
    starts a lock at its own `created_at`; once the lock has ended the count starts again from zero.
    """
    count, lock_end = 0, None
    for at in failures:
        if lock_end is not None and at >= lock_end:
            count, lock_end = 0, None
        count += 1
        if count == limit:
            lock_end = at + timedelta(seconds=lock_seconds)
    if lock_end is None or now >= lock_end:
        return 0
    return max(1, math.ceil((lock_end - now).total_seconds()))
