"""The sign-in failure limit, counted atomically per email key."""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass

from .config import CONFIG
from .db import DATABASE

FAILURE_ALLOWANCE = 5


@dataclass(frozen=True)
class Reservation:
    """A recorded attempt that becomes a failure unless the sign-in succeeds."""

    failure_id: int


@dataclass(frozen=True)
class Locked:
    retry_after: int


Attempt = Reservation | Locked


def _lock_key(email_key: str) -> int:
    digest = hashlib.sha256(email_key.encode("utf-8")).digest()[:8]
    return int.from_bytes(digest, "big", signed=True)


async def reserve_attempt(email_key: str) -> Attempt:
    """Count this attempt against the limit, or report the wait it must serve."""
    window = float(CONFIG.login_failure_window_seconds)
    async with DATABASE.acquire() as connection:
        async with connection.transaction():
            await connection.execute("SELECT pg_advisory_xact_lock($1)", _lock_key(email_key))
            await connection.execute(
                """
                DELETE FROM sign_in_failures
                WHERE email_key = $1 AND failed_at <= now() - make_interval(secs => $2)
                """,
                email_key,
                window,
            )
            row = await connection.fetchrow(
                """
                SELECT count(*) AS failures,
                       coalesce(
                           extract(epoch FROM min(failed_at) + make_interval(secs => $2) - now()),
                           0
                       ) AS seconds_left
                FROM sign_in_failures
                WHERE email_key = $1
                """,
                email_key,
                window,
            )
            if int(row["failures"]) >= FAILURE_ALLOWANCE:
                return Locked(retry_after=max(1, math.ceil(float(row["seconds_left"]))))
            failure_id = await connection.fetchval(
                """
                INSERT INTO sign_in_failures (email_key, failed_at)
                VALUES ($1, now())
                RETURNING id
                """,
                email_key,
            )
    return Reservation(failure_id=int(failure_id))


async def forget_failures(email_key: str) -> None:
    """A sign-in that answers 200 deletes that email key's failures."""
    await DATABASE.execute("DELETE FROM sign_in_failures WHERE email_key = $1", email_key)


async def release_reservation(reservation: Reservation) -> None:
    """An answer that records no failure gives its reserved attempt back."""
    await DATABASE.execute("DELETE FROM sign_in_failures WHERE id = $1", reservation.failure_id)
