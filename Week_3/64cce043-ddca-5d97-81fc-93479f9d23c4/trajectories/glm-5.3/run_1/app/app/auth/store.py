"""Accounts, sessions, pending sign-ins and vault bootstrap.

Every session is a random id in the `strongroom_session` cookie backed by a
Postgres row; the database clock decides idle expiry. The grant and scope are
re-read from the database on every request, never kept in a token or cookie.
"""

from __future__ import annotations

import secrets
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional

import asyncpg

from ..config import Config
from ..domain import DEFAULT_RULES, KINDS, LEVELS
from ..core.grading import GradingRule, grade, order_rules


def new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_urlsafe(18)}"


SESSION_COOKIE = "strongroom_session"
SIGNIN_COOKIE = "strongroom_signin"


@dataclass
class Account:
    id: str
    realm_sub: str
    email: str
    name: str
    vault_id: Optional[str]
    kind: str  # 'owner' or 'contact'

    @property
    def role(self) -> str:
        return "contact" if self.kind == "contact" else "owner"


@dataclass
class Context:
    """The caller's identity, vault and scope for one request or live stream."""

    account: Account
    db_now: datetime

    @property
    def vault_id(self) -> Optional[str]:
        return self.account.vault_id


class Store:
    """Database operations for accounts, sessions and pending sign-ins."""

    def __init__(self, db) -> None:  # db: app.db.base.Database
        self.db = db
        self.cfg: Config = db._cfg

    # --- Sessions ------------------------------------------------------------

    async def create_session(self, account_id: str) -> str:
        sid = new_id("sess")
        await self.db.execute(
            "INSERT INTO sessions (id, account_id) VALUES ($1, $2)", sid, account_id
        )
        return sid

    async def touch_session(self, session_id: str) -> None:
        await self.db.execute(
            "UPDATE sessions SET last_activity = now() WHERE id = $1", session_id
        )

    async def session_last_activity(self, session_id: str) -> Optional[datetime]:
        row = await self.db.fetchrow(
            "SELECT last_activity, now() AS db_now FROM sessions WHERE id = $1", session_id
        )
        if row is None:
            return None
        return row["last_activity"]

    async def end_session(self, session_id: str) -> None:
        await self.db.execute("DELETE FROM sessions WHERE id = $1", session_id)

    async def end_sessions_for_accounts(self, account_ids: list[str], keep: str | None) -> None:
        if not account_ids:
            return
        if keep:
            await self.db.execute(
                "DELETE FROM sessions WHERE account_id = ANY($1::text[]) AND id <> $2",
                account_ids,
                keep,
            )
        else:
            await self.db.execute(
                "DELETE FROM sessions WHERE account_id = ANY($1::text[])", account_ids
            )

    async def load_session(self, session_id: str) -> Optional[Account]:
        """Load the account for a session, applying idle expiry by the database clock."""
        row = await self.db.fetchrow(
            """
            SELECT s.id AS session_id, s.last_activity, now() AS db_now,
                   a.id AS account_id, a.realm_sub, a.email, a.name,
                   a.vault_id, a.kind
            FROM sessions s
            JOIN accounts a ON a.id = s.account_id
            WHERE s.id = $1
            """,
            session_id,
        )
        if row is None:
            return None
        idle = (row["db_now"] - row["last_activity"]).total_seconds()
        if idle > self.cfg.session_idle_seconds:
            await self.db.execute("DELETE FROM sessions WHERE id = $1", session_id)
            return None
        return Account(
            id=row["account_id"],
            realm_sub=row["realm_sub"],
            email=row["email"],
            name=row["name"],
            vault_id=row["vault_id"],
            kind=row["kind"],
        )

    # --- Pending sign-ins ------------------------------------------------------

    async def create_pending_signin(
        self, state: str, nonce: str, verifier: str, return_path: str | None
    ) -> str:
        pid = new_id("pend")
        await self.db.execute(
            """
            INSERT INTO pending_signins (id, state, nonce, verifier, return_path, expires_at)
            VALUES ($1, $2, $3, $4, $5, now() + make_interval(secs => $6))
            """,
            pid,
            state,
            nonce,
            verifier,
            return_path,
            self.cfg.signin_pending_seconds,
        )
        return pid

    async def consume_pending_signin(self, pending_id: str, state: str) -> Optional[asyncpg.Record]:
        """Single-use: consume the pending sign-in and return it, or None when invalid."""
        async def _op(conn: asyncpg.Connection) -> Optional[asyncpg.Record]:
            async with conn.transaction():
                row = await conn.fetchrow(
                    """
                    SELECT id, state, nonce, verifier, return_path, expires_at, consumed, now() AS db_now
                    FROM pending_signins WHERE id = $1
                    """,
                    pending_id,
                )
                if row is None or row["consumed"] or row["state"] != state:
                    return None
                if row["db_now"] >= row["expires_at"]:
                    await conn.execute("DELETE FROM pending_signins WHERE id = $1", pending_id)
                    return None
                await conn.execute(
                    "UPDATE pending_signins SET consumed = true WHERE id = $1", pending_id
                )
                return row

        return await self.db.run_in_transaction(_op)

    async def purge_expired_pending_signins(self) -> None:
        await self.db.execute("DELETE FROM pending_signins WHERE expires_at < now()")

    # --- Accounts ------------------------------------------------------------

    async def account_by_sub(self, sub: str) -> Optional[Account]:
        row = await self.db.fetchrow(
            "SELECT id, realm_sub, email, name, vault_id, kind FROM accounts WHERE realm_sub = $1",
            sub,
        )
        if row is None:
            return None
        return Account(
            id=row["id"], realm_sub=row["realm_sub"], email=row["email"],
            name=row["name"], vault_id=row["vault_id"], kind=row["kind"],
        )

    async def account_by_email_kind(self, email: str, kind: str) -> Optional[Account]:
        row = await self.db.fetchrow(
            "SELECT id, realm_sub, email, name, vault_id, kind FROM accounts WHERE email = $1 AND kind = $2",
            email,
            kind,
        )
        if row is None:
            return None
        return Account(
            id=row["id"], realm_sub=row["realm_sub"], email=row["email"],
            name=row["name"], vault_id=row["vault_id"], kind=row["kind"],
        )

    async def account_contact_for_vault(self, vault_id: str) -> Optional[Account]:
        row = await self.db.fetchrow(
            """
            SELECT a.id, a.realm_sub, a.email, a.name, a.vault_id, a.kind
            FROM accounts a WHERE a.vault_id = $1 AND a.kind = 'contact'
            """,
            vault_id,
        )
        if row is None:
            return None
        return Account(
            id=row["id"], realm_sub=row["realm_sub"], email=row["email"],
            name=row["name"], vault_id=row["vault_id"], kind=row["kind"],
        )

    async def create_account(
        self, realm_sub: str, email: str, name: str, kind: str, vault_id: str | None
    ) -> Account:
        aid = new_id("acct")
        await self.db.execute(
            """
            INSERT INTO accounts (id, realm_sub, email, name, kind, vault_id)
            VALUES ($1, $2, $3, $4, $5, $6)
            """,
            aid, realm_sub, email, name, kind, vault_id,
        )
        return Account(
            id=aid, realm_sub=realm_sub, email=email, name=name, vault_id=vault_id, kind=kind
        )

    async def attach_account_to_vault(self, account_id: str, vault_id: str) -> None:
        await self.db.execute(
            "UPDATE accounts SET vault_id = $2 WHERE id = $1", account_id, vault_id
        )

    # --- Vault bootstrap --------------------------------------------------------

    async def vault_exists(self, vault_id: str) -> bool:
        return await self.db.fetchval("SELECT 1 FROM vaults WHERE id = $1", vault_id) is not None

    async def vault_count(self) -> int:
        return await self.db.fetchval("SELECT count(*) FROM vaults") or 0

    async def bootstrap_vault_for_new_owner(self, email: str, name: str) -> Optional[str]:
        """Create a vault with the default rules for a new owner account, exactly once.

        Simultaneous first sign-ins of one new realm account create exactly one
        vault, guarded by a unique account email row and an advisory lock.
        """
        vault_id = new_id("vault")
        lock_key = f"vault:{email.casefold()}"
        async with self.db.pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute("SELECT pg_advisory_xact_lock(hashtext($1))", lock_key)
                # Was the vault created while we waited for the lock?
                row = await conn.fetchrow(
                    "SELECT vault_id FROM accounts WHERE email = $1 AND kind = 'owner'",
                    email,
                )
                if row is not None and row["vault_id"] is not None:
                    return row["vault_id"]
                await conn.execute("INSERT INTO vaults (id) VALUES ($1)", vault_id)
                await insert_default_rules(conn, vault_id)
                await conn.execute(
                    """
                    INSERT INTO accounts (id, realm_sub, email, name, kind, vault_id)
                    VALUES ($1, NULL, $2, $3, 'owner', $4)
                    """,
                    new_id("acct"), email, name, vault_id,
                )
                return vault_id


async def insert_default_rules(conn: asyncpg.Connection, vault_id: str) -> None:
    """Insert the twelve default grading rules at priorities 1 to 12."""
    rows = []
    for i, (kind, contains, level) in enumerate(DEFAULT_RULES, start=1):
        rows.append((new_id("rule"), vault_id, i, kind, contains, level))
    await conn.executemany(
        """
        INSERT INTO rules (id, vault_id, priority, data_kind, company_contains, level)
        VALUES ($1, $2, $3, $4, $5, $6)
        """,
        rows,
    )
