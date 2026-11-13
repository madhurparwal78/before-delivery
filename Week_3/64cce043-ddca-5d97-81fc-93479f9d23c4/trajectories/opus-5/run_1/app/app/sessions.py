"""App sessions, the caller behind a request, and one vault per account."""
from __future__ import annotations

import secrets
from dataclasses import dataclass
from datetime import datetime

import asyncpg

from .config import Settings
from .db import Database, new_id
from .grants import Grant, contact_grant
from .identity import SignedInPerson
from .seed import DEFAULT_RULES

OWNER_HOME = "/vault"
CONTACT_HOME = "/shared"
_FORBIDDEN_IN_RETURN_PATH = {chr(code) for code in list(range(32)) + [127]} | {"\\"}


@dataclass(frozen=True, slots=True)
class Caller:
    session_id: str
    account_id: str
    realm_user_id: str
    email: str
    name: str
    role: str
    vault_id: str
    grant: Grant | None
    db_now: datetime

    @property
    def is_contact(self) -> bool:
        return self.role == "contact"

    @property
    def scope_levels(self) -> frozenset[str] | None:
        if not self.is_contact or self.grant is None:
            return None
        return self.grant.scope_levels()

    @property
    def has_access(self) -> bool:
        if not self.is_contact:
            return True
        return self.grant is not None and self.grant.is_active(self.db_now)

    @property
    def home_path(self) -> str:
        return CONTACT_HOME if self.is_contact else OWNER_HOME


def new_session_id() -> str:
    return secrets.token_urlsafe(32)


def safe_return_path(next_value: str | None, role: str) -> str:
    """The return-path check: a `next` that fails it lands on the signer's default screen."""
    home = CONTACT_HOME if role == "contact" else OWNER_HOME
    if not next_value:
        return home
    if len(next_value) > 512:
        return home
    if not next_value.startswith("/") or next_value[1:2] in ("/", "\\"):
        return home
    if any(char in _FORBIDDEN_IN_RETURN_PATH or char.isspace() for char in next_value):
        return home
    path = next_value.split("?", 1)[0]
    if role == "contact":
        return next_value if path == CONTACT_HOME else home
    if path == OWNER_HOME or path.startswith("/vault/"):
        return next_value
    return home


async def resolve_caller(
    db: Database, settings: Settings, session_id: str | None, touch: bool
) -> Caller | None:
    """The signed-in person behind this request, or None when the session is gone or idle out."""
    if not session_id:
        return None
    query = (
        """with live as (
               update sessions set last_seen_at = now()
               where id = $1 and now() - last_seen_at < ($2 * interval '1 second')
               returning id, account_id, vault_id, role
           )
           select live.*, accounts.email, accounts.name, accounts.realm_user_id, now() as db_now
           from live join accounts on accounts.id = live.account_id"""
        if touch
        else """select sessions.id, sessions.account_id, sessions.vault_id, sessions.role,
                       accounts.email, accounts.name, accounts.realm_user_id, now() as db_now
                from sessions join accounts on accounts.id = sessions.account_id
                where sessions.id = $1
                  and now() - sessions.last_seen_at < ($2 * interval '1 second')"""
    )
    async with db.pool.acquire() as connection:
        row = await connection.fetchrow(query, session_id, settings.session_idle_seconds)
        if row is None:
            await connection.execute(
                """delete from sessions
                   where id = $1 and now() - last_seen_at >= ($2 * interval '1 second')""",
                session_id,
                settings.session_idle_seconds,
            )
            return None
        grant = (
            await contact_grant(connection, row["vault_id"], row["account_id"])
            if row["role"] == "contact"
            else None
        )
    return Caller(
        session_id=row["id"],
        account_id=row["account_id"],
        realm_user_id=row["realm_user_id"],
        email=row["email"],
        name=row["name"],
        role=row["role"],
        vault_id=row["vault_id"],
        grant=grant,
        db_now=row["db_now"],
    )


async def start_session(db: Database, person: SignedInPerson) -> tuple[str, str]:
    """Bind the realm account to its vault, then open a session. Returns (session id, role)."""
    async with db.transaction() as connection:
        account_id, kind = await _account_for(connection, person)
        if kind == "owner":
            vault_id = await _vault_for(connection, account_id)
            role = "owner"
        else:
            vault_id = await connection.fetchval(
                """select vault_id from grants where contact_account_id = $1
                   order by created_at desc limit 1""",
                account_id,
            )
            role = "contact"
        session_id = new_session_id()
        await connection.execute(
            "insert into sessions (id, account_id, vault_id, role) values ($1, $2, $3, $4)",
            session_id,
            account_id,
            vault_id,
            role,
        )
    return session_id, role


async def _account_for(
    connection: asyncpg.Connection, person: SignedInPerson
) -> tuple[str, str]:
    """An account is matched by realm user id, then once by email to a seed or grant."""
    row = await connection.fetchrow(
        "select id, kind from accounts where realm_user_id = $1", person.realm_user_id
    )
    if row is not None:
        return row["id"], row["kind"]
    row = await connection.fetchrow(
        """update accounts set realm_user_id = $1
           where email = $2 and realm_user_id is null
           returning id, kind""",
        person.realm_user_id,
        person.email,
    )
    if row is not None:
        return row["id"], row["kind"]
    row = await connection.fetchrow(
        """insert into accounts (id, realm_user_id, email, name, kind)
           values ($1, $2, $3, $4, 'owner')
           on conflict do nothing
           returning id, kind""",
        new_id(),
        person.realm_user_id,
        person.email,
        person.name,
    )
    if row is not None:
        return row["id"], row["kind"]
    row = await connection.fetchrow(
        "select id, kind from accounts where realm_user_id = $1", person.realm_user_id
    )
    return row["id"], row["kind"]


async def _vault_for(connection: asyncpg.Connection, account_id: str) -> str:
    """Exactly one vault per owner account, with the twelve default rules."""
    created = await connection.fetchrow(
        """insert into vaults (id, owner_account_id) values ($1, $2)
           on conflict (owner_account_id) do nothing
           returning id""",
        new_id(),
        account_id,
    )
    if created is None:
        return await connection.fetchval(
            "select id from vaults where owner_account_id = $1", account_id
        )
    vault_id = created["id"]
    for index, (data_kind, level) in enumerate(DEFAULT_RULES):
        await connection.execute(
            """insert into grading_rules (id, vault_id, priority, data_kind, level, created_at)
               values ($1, $2, $3, $4, $5, now() + ($6 * interval '1 millisecond'))""",
            new_id(),
            vault_id,
            index + 1,
            data_kind,
            level,
            index,
        )
    return vault_id


async def end_session(db: Database, session_id: str) -> None:
    await db.execute("delete from sessions where id = $1", session_id)
