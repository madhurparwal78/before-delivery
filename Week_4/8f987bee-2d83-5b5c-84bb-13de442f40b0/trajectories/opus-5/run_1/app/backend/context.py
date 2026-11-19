"""The caller behind a request: their session, their workspace and their current role."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from fastapi import Request

from .db import database
from .errors import ApiError
from .security import token_fingerprint


@dataclass(frozen=True)
class Caller:
    user_id: uuid.UUID
    email: str
    name: str
    role: str
    workspace_id: uuid.UUID
    preferences: dict[str, Any]
    token: str


def iso(moment: datetime | None) -> str | None:
    """Every timestamp this app reports is ISO 8601 in UTC, ending in Z."""
    if moment is None:
        return None
    return moment.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def bearer_token(request: Request) -> str | None:
    header = request.headers.get("authorization")
    if header and header.lower().startswith("bearer "):
        return header[7:].strip() or None
    return None


async def require_session(request: Request, *, token: str | None = None) -> Caller:
    """Every console request without a valid session answers 401."""
    presented = token or bearer_token(request)
    if not presented:
        raise ApiError("unauthenticated")
    row = await database.fetchrow(
        """
        SELECT u.id, u.email, u.name, u.preferences, m.role, m.workspace_id
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        JOIN memberships m ON m.user_id = u.id
        WHERE s.token_hash = $1
        """,
        token_fingerprint(presented),
    )
    if row is None:
        raise ApiError("unauthenticated")
    return Caller(
        user_id=row["id"],
        email=row["email"],
        name=row["name"],
        role=row["role"],
        workspace_id=row["workspace_id"],
        preferences=row["preferences"],
        token=presented,
    )


def require_writer(caller: Caller) -> None:
    """Viewers read; they create, change, check, run, cancel and reset nothing."""
    if caller.role == "viewer":
        raise ApiError("forbidden")


def require_admin(caller: Caller) -> None:
    if caller.role != "admin":
        raise ApiError("forbidden")


def request_id_of(request: Request) -> str:
    return request.state.request_id
