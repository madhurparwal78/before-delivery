"""The PostgreSQL connection pool, readiness, the one-time bootstrap and the outage boundary."""

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from importlib import resources

import asyncpg

from . import seed
from .config import SETTINGS
from .passwords import hash_password_sync

log = logging.getLogger("downtime.db")

CONNECT_TIMEOUT = 3
COMMAND_TIMEOUT = 4
BOOTSTRAP_RETRY_SECONDS = 1
SCHEMA = resources.files(__package__).joinpath("schema.sql").read_text()

# Raised by the driver or the network when the database cannot be reached.
DRIVER_ERRORS = (OSError, TimeoutError, asyncpg.PostgresConnectionError, asyncpg.InterfaceError,
                 asyncpg.CannotConnectNowError, asyncpg.QueryCanceledError)


class Unavailable(Exception):
    """The database cannot be reached; the API answers 503 unavailable."""


class Database:
    def __init__(self) -> None:
        self.pool: asyncpg.Pool | None = None
        self.ready = False

    async def bootstrap(self) -> None:
        """Create the schema and seed once, retrying until the database answers."""
        while True:
            try:
                if self.pool is None:
                    self.pool = await asyncpg.create_pool(
                        SETTINGS.database_url, min_size=0, max_size=20, timeout=CONNECT_TIMEOUT,
                        command_timeout=COMMAND_TIMEOUT, max_inactive_connection_lifetime=60)
                async with self.pool.acquire(timeout=CONNECT_TIMEOUT) as conn, conn.transaction():
                    await conn.execute("SELECT pg_advisory_xact_lock(hashtextextended('downtime:bootstrap', 0))",
                                       timeout=120)
                    await conn.execute(SCHEMA)
                    if not await conn.fetchval("SELECT EXISTS (SELECT 1 FROM scenarios)"):
                        await _write_seed(conn)
                self.ready = True
                log.info("schema and seed ready")
                return
            except DRIVER_ERRORS as error:
                log.warning("database not ready: %s", type(error).__name__)
                await asyncio.sleep(BOOTSTRAP_RETRY_SECONDS)

    async def health(self) -> str:
        """`ok`, `starting` (no schema and seed yet) or `unavailable` (lost after start); checked per call."""
        if not self.ready:
            return "starting"
        try:
            async with self.connection() as conn:
                await conn.fetchval("SELECT 1", timeout=2)
        except Unavailable:
            return "unavailable"
        return "ok"

    @asynccontextmanager
    async def connection(self) -> AsyncIterator[asyncpg.Connection]:
        if not self.ready or self.pool is None:
            raise Unavailable
        try:
            async with self.pool.acquire(timeout=CONNECT_TIMEOUT) as conn:
                yield conn
        except DRIVER_ERRORS as error:
            raise Unavailable from error

    @asynccontextmanager
    async def transaction(self) -> AsyncIterator[asyncpg.Connection]:
        async with self.connection() as conn, conn.transaction():
            yield conn

    async def close(self) -> None:
        if self.pool is not None:
            await self.pool.close()


async def serialise(conn: asyncpg.Connection, key: str) -> None:
    """Hold a transaction-scoped advisory lock so simultaneous requests for `key` run one at a time."""
    await conn.execute("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", key)


async def _write_seed(conn: asyncpg.Connection) -> None:
    await conn.executemany(
        "INSERT INTO scenarios (slug, number, title, kind, points, description, flag_sha256) "
        "VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [(s.slug, s.number, s.title, s.kind, s.points, s.description, s.flag_sha256) for s in seed.SCENARIOS])
    people = [(t.captain_email, t.captain_name, t.created) for t in seed.SEED_TEAMS]
    people += [(email, name, joined) for _, email, name, joined in seed.SEED_MEMBERS]
    people.append(seed.SOLO)
    hashes = await asyncio.gather(*(asyncio.to_thread(hash_password_sync, seed.SEED_PASSWORD) for _ in people))
    ids = {}
    for (email, name, created), password_hash in zip(people, hashes, strict=True):
        ids[email] = await conn.fetchval(
            "INSERT INTO users (email, display_name, password_hash, created_at) VALUES ($1, $2, $3, $4) "
            "RETURNING id", email, name, password_hash, created)
    teams = {}
    for team in seed.SEED_TEAMS:
        captain = ids[team.captain_email]
        teams[team.name] = await conn.fetchval(
            "INSERT INTO teams (name, invite_code, captain_id, created_at) VALUES ($1, $2, $3, $4) RETURNING id",
            team.name, team.code, captain, team.created)
        await conn.execute("INSERT INTO memberships (user_id, team_id, joined_at) VALUES ($1, $2, $3)",
                           captain, teams[team.name], team.created)
        for scenario, at in seed.team_solve_times(team):
            await conn.execute("INSERT INTO team_solves (team_id, scenario_slug, user_id, created_at) "
                               "VALUES ($1, $2, $3, $4)", teams[team.name], scenario.slug, captain, at)
            await conn.execute("INSERT INTO completions (user_id, scenario_slug, team_id, created_at) "
                               "VALUES ($1, $2, $3, $4)", captain, scenario.slug, teams[team.name], at)
    await conn.executemany("INSERT INTO memberships (user_id, team_id, joined_at) VALUES ($1, $2, $3)",
                           [(ids[email], teams[team], joined) for team, email, _, joined in seed.SEED_MEMBERS])


DB = Database()
