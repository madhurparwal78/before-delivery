"""Sessions: the cookie token is stored only as its SHA-256."""

import hashlib
import uuid
from dataclasses import dataclass

from .db import Database

SESSION_COOKIE = "edgeprint_session"


@dataclass(frozen=True, slots=True)
class Account:
    id: uuid.UUID
    email: str


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def session_account(db: Database, token: str) -> Account | None:
    async with db.connection() as connection:
        row = await connection.fetchrow(
            "SELECT a.id, a.email FROM sessions s JOIN accounts a ON a.id = s.account_id"
            " WHERE s.token_hash = $1 AND s.expires_at > now()", token_hash(token))
    return Account(row["id"], row["email"]) if row else None
