"""Invitation lifetime: accepted only while the clock is earlier than `expires_at`."""

import uuid
from datetime import datetime, timedelta

import asyncpg

from .config import settings
from .db import utcnow


def expires_at(created_at: datetime) -> datetime:
    return created_at + timedelta(seconds=settings.invite_ttl_seconds)


def expired(at: datetime) -> bool:
    return utcnow() >= at


async def open_invitation(conn: asyncpg.Connection, email: str, workspace_id: uuid.UUID) -> bool:
    """An invitation counts as open while it is unused and not expired."""
    rows = await conn.fetch("SELECT expires_at FROM invites WHERE email = $1 AND workspace_id = $2 AND NOT used",
                            email, workspace_id)
    return any(not expired(row["expires_at"]) for row in rows)
