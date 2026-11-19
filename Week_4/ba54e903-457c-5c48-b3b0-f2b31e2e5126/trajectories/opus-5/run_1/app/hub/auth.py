"""Sessions, the sign-in lockout, confirmation links and ended sessions."""

from __future__ import annotations

import hashlib
import math
import secrets
from typing import Any

import asyncpg

from .config import CONFIG
from .db import DB
from .errors import ApiError, invalid, rate_limited
from .users import Caller

CALLER_SQL = """
SELECT m.id, m.email, m.email_verified, m.username, m.display_name, m.avatar_ref,
       m.status, m.tier, m.app_icon, m.created_at
FROM sessions s
JOIN members m ON m.id = s.member_id
WHERE s.token_digest = $1 AND s.revoked_at IS NULL
"""


def new_token() -> str:
    return secrets.token_urlsafe(32)


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


async def caller_for_token(token: str) -> Caller | None:
    row = await DB.fetchrow(CALLER_SQL, token_digest(token))
    if row is None:
        return None
    return Caller(
        id=row["id"],
        email=row["email"],
        email_verified=row["email_verified"],
        username=row["username"],
        display_name=row["display_name"],
        avatar_ref=row["avatar_ref"],
        status=row["status"],
        tier=row["tier"],
        app_icon=row["app_icon"],
        created_at=row["created_at"],
        token_digest=token_digest(token),
    )


async def create_session(conn: asyncpg.Connection, member_id: int) -> str:
    token = new_token()
    await conn.execute(
        "INSERT INTO sessions (member_id, token_digest) VALUES ($1, $2)",
        member_id,
        token_digest(token),
    )
    return token


async def revoke_session(conn: asyncpg.Connection, digest: str) -> None:
    await conn.execute(
        """
        UPDATE sessions SET revoked_at = date_trunc('second', now())
        WHERE token_digest = $1 AND revoked_at IS NULL
        """,
        digest,
    )


async def revoke_other_sessions(
    conn: asyncpg.Connection, member_id: int, keep_digest: str
) -> None:
    await conn.execute(
        """
        UPDATE sessions SET revoked_at = date_trunc('second', now())
        WHERE member_id = $1 AND token_digest <> $2 AND revoked_at IS NULL
        """,
        member_id,
        keep_digest,
    )


# --- sign-in lockout ------------------------------------------------------


async def lock_login_email(conn: asyncpg.Connection, email: str) -> None:
    """Serialise every sign-in decision for one email, on every instance."""
    await conn.execute("SELECT pg_advisory_xact_lock(hashtext($1))", f"login:{email.lower()}")


async def lockout_refusal(conn: asyncpg.Connection, email: str) -> ApiError | None:
    """The 429 a locked email earns, decided before the password is even read."""
    row = await conn.fetchrow(
        """
        SELECT count(*) AS failures,
               max(created_at) AS newest,
               EXTRACT(EPOCH FROM (max(created_at) + make_interval(secs => $2)
                                   - clock_timestamp())) AS seconds_left
        FROM login_failures
        WHERE email = $1 AND created_at > clock_timestamp() - make_interval(secs => $2)
        """,
        email.lower(),
        CONFIG.login_lockout_seconds,
    )
    if row is None or row["failures"] < 5:
        return None
    seconds_left = int(math.ceil(float(row["seconds_left"] or 0)))
    return rate_limited(max(1, min(CONFIG.login_lockout_seconds, seconds_left)))


async def record_login_failure(conn: asyncpg.Connection, email: str) -> None:
    await conn.execute("INSERT INTO login_failures (email) VALUES ($1)", email.lower())


async def clear_login_failures(conn: asyncpg.Connection, email: str) -> None:
    await conn.execute("DELETE FROM login_failures WHERE email = $1", email.lower())


# --- confirmation links ---------------------------------------------------


async def queue_confirmation(
    conn: asyncpg.Connection, member: dict[str, Any] | asyncpg.Record
) -> None:
    """Supersede every earlier token and queue one confirmation email."""
    from .mail import queue_email

    token = new_token()
    await conn.execute(
        """
        UPDATE email_tokens SET superseded_at = date_trunc('second', now())
        WHERE member_id = $1 AND used_at IS NULL AND superseded_at IS NULL
        """,
        member["id"],
    )
    await conn.execute(
        """
        INSERT INTO email_tokens (member_id, token_digest, expires_at)
        VALUES ($1, $2, date_trunc('second', now()) + make_interval(secs => $3))
        """,
        member["id"],
        token_digest(token),
        CONFIG.email_token_ttl_seconds,
    )
    link = f"{CONFIG.public_url}/verify-email?token={token}"
    await queue_email(
        conn,
        recipient=member["email"],
        recipient_name=member["display_name"],
        subject="Confirm your Community Hub account",
        body=(
            f"Hi {member['display_name']}, confirm your email for @{member['username']}.\n"
            f"Confirm your address: {link}\n"
        ),
    )


async def confirm_email_token(conn: asyncpg.Connection, token: str) -> None:
    row = await conn.fetchrow(
        """
        UPDATE email_tokens SET used_at = date_trunc('second', now())
        WHERE token_digest = $1 AND used_at IS NULL AND superseded_at IS NULL
          AND expires_at > clock_timestamp()
        RETURNING member_id
        """,
        token_digest(token),
    )
    if row is None:
        raise invalid("token")
    await conn.execute("UPDATE members SET email_verified = true WHERE id = $1", row["member_id"])


async def self_user(conn: asyncpg.Connection, member_id: int) -> dict[str, Any]:
    row = await conn.fetchrow(
        """
        SELECT id, email, email_verified, username, display_name, avatar_ref,
               status, tier, app_icon, created_at
        FROM members WHERE id = $1
        """,
        member_id,
    )
    if row is None:
        raise ApiError(401, "unauthorized")
    return Caller(
        id=row["id"],
        email=row["email"],
        email_verified=row["email_verified"],
        username=row["username"],
        display_name=row["display_name"],
        avatar_ref=row["avatar_ref"],
        status=row["status"],
        tier=row["tier"],
        app_icon=row["app_icon"],
        created_at=row["created_at"],
        token_digest="",
    ).as_self()
