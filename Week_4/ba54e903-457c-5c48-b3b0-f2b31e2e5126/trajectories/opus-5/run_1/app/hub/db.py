"""The PostgreSQL connection pool, the schema and the start-up seeding."""

from __future__ import annotations

import asyncio
import contextlib
from typing import Any, AsyncIterator

import asyncpg

from .config import CONFIG

SCHEMA_LOCK_KEY = 0x48554253  # "HUBS"
POOL_MAX_SIZE = 14

STATEMENTS: tuple[str, ...] = (
    """
    CREATE TABLE IF NOT EXISTS members (
        id serial PRIMARY KEY,
        email text NOT NULL,
        email_verified boolean NOT NULL DEFAULT false,
        username text NOT NULL,
        display_name text NOT NULL,
        avatar_ref text NOT NULL,
        password_hash text NOT NULL,
        date_of_birth date NOT NULL,
        status text NOT NULL DEFAULT 'online',
        tier text NOT NULL DEFAULT 'free',
        app_icon text NOT NULL DEFAULT 'classic',
        created_at timestamptz NOT NULL DEFAULT date_trunc('second', now())
    )
    """,
    "CREATE UNIQUE INDEX IF NOT EXISTS members_email_idx ON members (lower(email))",
    "CREATE UNIQUE INDEX IF NOT EXISTS members_username_idx ON members (lower(username))",
    """
    CREATE TABLE IF NOT EXISTS communities (
        id serial PRIMARY KEY,
        slug text NOT NULL UNIQUE,
        name text NOT NULL,
        description text NOT NULL DEFAULT '',
        icon_ref text NOT NULL,
        splash_ref text NOT NULL,
        banner_ref text NOT NULL,
        category text NOT NULL,
        keywords text[] NOT NULL DEFAULT '{}',
        verified boolean NOT NULL DEFAULT false,
        partnered boolean NOT NULL DEFAULT false,
        published boolean NOT NULL DEFAULT true,
        verification_level text NOT NULL DEFAULT 'none',
        presence_baseline integer NOT NULL DEFAULT 0,
        member_baseline integer NOT NULL DEFAULT 0,
        owner_id integer REFERENCES members (id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT date_trunc('second', now())
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS channels (
        id serial PRIMARY KEY,
        community_id integer NOT NULL REFERENCES communities (id) ON DELETE CASCADE,
        name text NOT NULL,
        category_group text NOT NULL DEFAULT '',
        position integer NOT NULL DEFAULT 0,
        topic text NOT NULL DEFAULT '',
        type text NOT NULL DEFAULT 'text',
        slowmode_seconds integer NOT NULL DEFAULT 0
    )
    """,
    "CREATE INDEX IF NOT EXISTS channels_community_idx ON channels (community_id, position)",
    """
    CREATE TABLE IF NOT EXISTS memberships (
        id serial PRIMARY KEY,
        member_id integer NOT NULL REFERENCES members (id) ON DELETE CASCADE,
        community_id integer NOT NULL REFERENCES communities (id) ON DELETE CASCADE,
        role text NOT NULL DEFAULT 'member',
        muted boolean NOT NULL DEFAULT false,
        joined_at timestamptz NOT NULL DEFAULT date_trunc('second', now()),
        communication_disabled_until timestamptz,
        UNIQUE (member_id, community_id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS roles (
        id serial PRIMARY KEY,
        community_id integer NOT NULL REFERENCES communities (id) ON DELETE CASCADE,
        name text NOT NULL,
        position integer NOT NULL DEFAULT 0,
        permissions text[] NOT NULL DEFAULT '{}',
        is_default boolean NOT NULL DEFAULT false
    )
    """,
    "CREATE INDEX IF NOT EXISTS roles_community_idx ON roles (community_id, position)",
    """
    CREATE TABLE IF NOT EXISTS member_roles (
        id serial PRIMARY KEY,
        community_id integer NOT NULL REFERENCES communities (id) ON DELETE CASCADE,
        member_id integer NOT NULL REFERENCES members (id) ON DELETE CASCADE,
        role_id integer NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
        UNIQUE (member_id, role_id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS channel_overwrites (
        id serial PRIMARY KEY,
        channel_id integer NOT NULL REFERENCES channels (id) ON DELETE CASCADE,
        target_type text NOT NULL,
        target_id integer NOT NULL,
        allow text[] NOT NULL DEFAULT '{}',
        deny text[] NOT NULL DEFAULT '{}',
        UNIQUE (channel_id, target_type, target_id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS bans (
        id serial PRIMARY KEY,
        community_id integer NOT NULL REFERENCES communities (id) ON DELETE CASCADE,
        member_id integer NOT NULL REFERENCES members (id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT date_trunc('second', now()),
        UNIQUE (community_id, member_id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS invites (
        id serial PRIMARY KEY,
        code text NOT NULL UNIQUE,
        community_id integer NOT NULL REFERENCES communities (id) ON DELETE CASCADE,
        inviter_id integer NOT NULL REFERENCES members (id) ON DELETE CASCADE,
        uses integer NOT NULL DEFAULT 0,
        max_uses integer NOT NULL DEFAULT 0,
        max_age_seconds integer NOT NULL DEFAULT 86400,
        expires_at timestamptz,
        created_at timestamptz NOT NULL,
        revoked_at timestamptz
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS messages (
        id serial PRIMARY KEY,
        channel_id integer NOT NULL REFERENCES channels (id) ON DELETE CASCADE,
        author_id integer NOT NULL REFERENCES members (id) ON DELETE CASCADE,
        body text NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT date_trunc('second', now()),
        edited_at timestamptz,
        reply_to_id integer REFERENCES messages (id) ON DELETE SET NULL,
        nonce text,
        mentions integer[] NOT NULL DEFAULT '{}'
    )
    """,
    "CREATE INDEX IF NOT EXISTS messages_channel_idx ON messages (channel_id, id DESC)",
    "CREATE INDEX IF NOT EXISTS messages_reply_idx ON messages (reply_to_id)",
    """
    CREATE UNIQUE INDEX IF NOT EXISTS messages_nonce_idx
        ON messages (channel_id, author_id, nonce) WHERE nonce IS NOT NULL
    """,
    """
    CREATE TABLE IF NOT EXISTS reactions (
        id serial PRIMARY KEY,
        message_id integer NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
        member_id integer NOT NULL REFERENCES members (id) ON DELETE CASCADE,
        emoji text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT date_trunc('second', now()),
        UNIQUE (message_id, member_id, emoji)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS attachments (
        id serial PRIMARY KEY,
        uploader_id integer NOT NULL REFERENCES members (id) ON DELETE CASCADE,
        message_id integer REFERENCES messages (id) ON DELETE CASCADE,
        filename text NOT NULL,
        size_bytes integer NOT NULL,
        content_type text NOT NULL,
        sha256 text NOT NULL,
        data bytea NOT NULL,
        width integer,
        height integer,
        duration_ms integer,
        position integer NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT date_trunc('second', now())
    )
    """,
    "CREATE INDEX IF NOT EXISTS attachments_message_idx ON attachments (message_id, position)",
    """
    CREATE TABLE IF NOT EXISTS read_states (
        id serial PRIMARY KEY,
        member_id integer NOT NULL REFERENCES members (id) ON DELETE CASCADE,
        channel_id integer NOT NULL REFERENCES channels (id) ON DELETE CASCADE,
        last_read_message_id integer,
        UNIQUE (member_id, channel_id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS notifications (
        id serial PRIMARY KEY,
        recipient_id integer NOT NULL REFERENCES members (id) ON DELETE CASCADE,
        message_id integer REFERENCES messages (id) ON DELETE CASCADE,
        channel_id integer REFERENCES channels (id) ON DELETE CASCADE,
        community_id integer NOT NULL REFERENCES communities (id) ON DELETE CASCADE,
        actor_id integer REFERENCES members (id) ON DELETE CASCADE,
        kind text NOT NULL,
        read boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT date_trunc('second', now())
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS notifications_recipient_idx
        ON notifications (recipient_id, id DESC)
    """,
    """
    CREATE UNIQUE INDEX IF NOT EXISTS notifications_one_per_message_idx
        ON notifications (recipient_id, message_id, kind) WHERE message_id IS NOT NULL
    """,
    """
    CREATE TABLE IF NOT EXISTS subscriptions (
        id serial PRIMARY KEY,
        member_id integer NOT NULL REFERENCES members (id) ON DELETE CASCADE,
        tier text NOT NULL,
        amount_cents integer NOT NULL,
        status text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT date_trunc('second', now())
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS support_tickets (
        id serial PRIMARY KEY,
        reference text NOT NULL,
        email text NOT NULL,
        category text NOT NULL,
        subject text NOT NULL,
        body text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT date_trunc('second', now())
    )
    """,
    "CREATE INDEX IF NOT EXISTS support_email_idx ON support_tickets (lower(email), created_at)",
    """
    CREATE TABLE IF NOT EXISTS page_views (
        id serial PRIMARY KEY,
        path text NOT NULL,
        visitor_id text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT date_trunc('second', now())
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS outbox (
        id serial PRIMARY KEY,
        recipient text NOT NULL,
        recipient_name text NOT NULL DEFAULT '',
        subject text NOT NULL,
        body text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT date_trunc('second', now()),
        sent_at timestamptz
    )
    """,
    "CREATE INDEX IF NOT EXISTS outbox_pending_idx ON outbox (id) WHERE sent_at IS NULL",
    """
    CREATE TABLE IF NOT EXISTS sessions (
        id serial PRIMARY KEY,
        member_id integer NOT NULL REFERENCES members (id) ON DELETE CASCADE,
        token_digest text NOT NULL UNIQUE,
        created_at timestamptz NOT NULL DEFAULT date_trunc('second', now()),
        revoked_at timestamptz
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS email_tokens (
        id serial PRIMARY KEY,
        member_id integer NOT NULL REFERENCES members (id) ON DELETE CASCADE,
        token_digest text NOT NULL UNIQUE,
        created_at timestamptz NOT NULL DEFAULT date_trunc('second', now()),
        expires_at timestamptz NOT NULL,
        used_at timestamptz,
        superseded_at timestamptz
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS login_failures (
        id serial PRIMARY KEY,
        email text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT date_trunc('second', now())
    )
    """,
    "CREATE INDEX IF NOT EXISTS login_failures_idx ON login_failures (email, created_at DESC)",
    """
    CREATE TABLE IF NOT EXISTS idempotency_keys (
        id serial PRIMARY KEY,
        member_id integer NOT NULL REFERENCES members (id) ON DELETE CASCADE,
        key text NOT NULL,
        tier text NOT NULL,
        card_digits text NOT NULL,
        status_code integer NOT NULL,
        response jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT date_trunc('second', now()),
        UNIQUE (member_id, key)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS games (
        id serial PRIMARY KEY,
        slug text NOT NULL UNIQUE,
        name text NOT NULL,
        description text NOT NULL,
        cover_ref text NOT NULL,
        categories text[] NOT NULL DEFAULT '{}',
        community_id integer REFERENCES communities (id) ON DELETE SET NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS game_weeks (
        id serial PRIMARY KEY,
        game_id integer NOT NULL REFERENCES games (id) ON DELETE CASCADE,
        week_date date NOT NULL,
        rank integer NOT NULL,
        plays_change_pct integer NOT NULL,
        streams_change_pct integer NOT NULL,
        UNIQUE (game_id, week_date)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS safety_articles (
        id serial PRIMARY KEY,
        slug text NOT NULL UNIQUE,
        title text NOT NULL,
        category text NOT NULL,
        topic text NOT NULL,
        summary text NOT NULL,
        body text NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS live_events (
        id serial PRIMARY KEY,
        type text NOT NULL,
        community_id integer,
        channel_id integer,
        recipient_id integer,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT date_trunc('second', now())
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS seed_state (
        id serial PRIMARY KEY,
        name text NOT NULL UNIQUE,
        created_at timestamptz NOT NULL DEFAULT date_trunc('second', now())
    )
    """,
)


class Database:
    """Owns the pool and reports whether the product is ready to answer."""

    def __init__(self) -> None:
        self._pool: asyncpg.Pool | None = None
        self._task: asyncio.Task[None] | None = None
        self.ready = False

    async def start(self) -> None:
        self._task = asyncio.create_task(self._prepare_forever())

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
        if self._pool is not None:
            await self._pool.close()

    async def _prepare_forever(self) -> None:
        from .seed import seed_everything

        while True:
            try:
                if self._pool is None:
                    self._pool = await asyncpg.create_pool(
                        CONFIG.database_url,
                        min_size=1,
                        max_size=POOL_MAX_SIZE,
                        server_settings={"timezone": "UTC"},
                        command_timeout=20,
                        max_inactive_connection_lifetime=60,
                    )
                async with self._pool.acquire() as conn:
                    async with conn.transaction():
                        await conn.execute("SELECT pg_advisory_xact_lock($1)", SCHEMA_LOCK_KEY)
                        for statement in STATEMENTS:
                            await conn.execute(statement)
                        await seed_everything(conn)
                self.ready = True
                return
            except (asyncpg.PostgresError, OSError, asyncio.TimeoutError):
                self.ready = False
                if self._pool is not None:
                    with contextlib.suppress(Exception):
                        await self._pool.close()
                    self._pool = None
                await asyncio.sleep(2)

    @contextlib.asynccontextmanager
    async def connection(self) -> AsyncIterator[asyncpg.Connection]:
        if self._pool is None:
            raise ConnectionError("database is not ready")
        async with self._pool.acquire() as conn:
            yield conn

    @contextlib.asynccontextmanager
    async def transaction(self) -> AsyncIterator[asyncpg.Connection]:
        async with self.connection() as conn:
            async with conn.transaction():
                yield conn

    async def healthy(self) -> bool:
        if not self.ready or self._pool is None:
            return False
        try:
            async with self.connection() as conn:
                await conn.fetchval("SELECT 1")
        except (asyncpg.PostgresError, OSError, asyncio.TimeoutError, ConnectionError):
            return False
        return True

    async def fetch(self, query: str, *args: Any) -> list[asyncpg.Record]:
        async with self.connection() as conn:
            return await conn.fetch(query, *args)

    async def fetchrow(self, query: str, *args: Any) -> asyncpg.Record | None:
        async with self.connection() as conn:
            return await conn.fetchrow(query, *args)

    async def fetchval(self, query: str, *args: Any) -> Any:
        async with self.connection() as conn:
            return await conn.fetchval(query, *args)

    async def execute(self, query: str, *args: Any) -> str:
        async with self.connection() as conn:
            return await conn.execute(query, *args)


DB = Database()
