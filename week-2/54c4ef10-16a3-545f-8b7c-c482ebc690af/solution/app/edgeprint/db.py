"""PostgreSQL: the connection pool, the idempotent schema and the first-start seed."""

import asyncio
import json
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

import asyncpg

from .config import Settings
from .seed import seed_if_empty
from .errors import ApiError

RETRY_SECONDS = 1.0
POOL_SIZE = 12
SCHEMA_LOCK = 7_422_031

SCHEMA = """
CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY, email text NOT NULL UNIQUE, password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY, account_id uuid NOT NULL REFERENCES accounts ON DELETE CASCADE,
  expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS rolls (
  id uuid PRIMARY KEY, seq bigserial, account_id uuid NOT NULL REFERENCES accounts ON DELETE CASCADE,
  name text NOT NULL, stock text NOT NULL, format text NOT NULL, ei integer NOT NULL, push_pull integer NOT NULL,
  reciprocity_p numeric(3, 2) NOT NULL, development_note text NOT NULL, kind text NOT NULL,
  curve_roll_id uuid REFERENCES rolls ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(),
  proposal jsonb, alignment_version integer NOT NULL DEFAULT 0, alignment_offset integer, alignment_slip integer,
  alignment_source text, alignment_saved_at timestamptz);
CREATE INDEX IF NOT EXISTS rolls_account ON rolls (account_id, seq DESC);
CREATE TABLE IF NOT EXISTS entries (
  id uuid PRIMARY KEY, seq bigserial, roll_id uuid NOT NULL REFERENCES rolls ON DELETE CASCADE,
  counter integer NOT NULL, aperture text NOT NULL, shutter text NOT NULL, metered_ev double precision NOT NULL,
  note text NOT NULL, misfire boolean NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (roll_id, counter));
CREATE TABLE IF NOT EXISTS scans (
  id uuid PRIMARY KEY, roll_id uuid NOT NULL REFERENCES rolls ON DELETE CASCADE, position integer NOT NULL,
  filename text NOT NULL, format text NOT NULL, size bigint NOT NULL, sha256 text NOT NULL, width integer NOT NULL,
  height integer NOT NULL, dpi integer NOT NULL, first_edge integer NOT NULL, transfer text NOT NULL,
  gamma double precision, state text NOT NULL, calibration_id uuid, base_fog double precision,
  preview_slices integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (roll_id, position), UNIQUE (roll_id, sha256));
CREATE TABLE IF NOT EXISTS calibrations (
  id uuid PRIMARY KEY, scan_id uuid NOT NULL REFERENCES scans ON DELETE CASCADE, method text NOT NULL,
  area jsonb NOT NULL, reference double precision, steps jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS frames (
  id uuid PRIMARY KEY, scan_id uuid NOT NULL REFERENCES scans ON DELETE CASCADE, number integer NOT NULL,
  edge_number integer NOT NULL, x0 integer NOT NULL, x1 integer NOT NULL, flag text NOT NULL,
  blank_slot boolean NOT NULL, mean_density double precision NOT NULL, net_density double precision NOT NULL,
  unexposed boolean NOT NULL, title text NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS frames_scan ON frames (scan_id, x0);
CREATE TABLE IF NOT EXISTS overrides (
  entry_id uuid PRIMARY KEY REFERENCES entries ON DELETE CASCADE, roll_id uuid NOT NULL REFERENCES rolls ON DELETE CASCADE,
  frame_id uuid REFERENCES frames ON DELETE CASCADE);
CREATE UNIQUE INDEX IF NOT EXISTS overrides_frame ON overrides (roll_id, frame_id) WHERE frame_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS readings (
  id uuid PRIMARY KEY, scan_id uuid NOT NULL REFERENCES scans ON DELETE CASCADE,
  frame_id uuid NOT NULL REFERENCES frames ON DELETE CASCADE, entry_id uuid REFERENCES entries ON DELETE SET NULL,
  x integer NOT NULL, y integer NOT NULL, gross double precision NOT NULL, net double precision NOT NULL,
  calibration_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS readings_frame ON readings (frame_id, created_at);
"""


async def _json_codec(connection: asyncpg.Connection) -> None:
    await connection.set_type_codec("jsonb", encoder=json.dumps, decoder=json.loads, schema="pg_catalog")


class Database:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.pool: asyncpg.Pool | None = None

    @property
    def ready(self) -> bool:
        return self.pool is not None

    async def connect(self) -> None:
        """Keep trying until PostgreSQL answers, then apply the schema and, on an empty database, the seed."""
        while self.pool is None:
            try:
                pool = await asyncpg.create_pool(self.settings.database_url, min_size=1, max_size=POOL_SIZE,
                                                 init=_json_codec)
            except (OSError, asyncpg.PostgresError, asyncpg.InterfaceError):
                await asyncio.sleep(RETRY_SECONDS)
                continue
            async with pool.acquire() as connection:
                await connection.execute("SELECT pg_advisory_lock($1)", SCHEMA_LOCK)
                try:
                    await connection.execute(SCHEMA)
                    await seed_if_empty(connection)
                finally:
                    await connection.execute("SELECT pg_advisory_unlock($1)", SCHEMA_LOCK)
            self.pool = pool

    async def close(self) -> None:
        if self.pool is not None:
            await self.pool.close()

    @asynccontextmanager
    async def connection(self) -> AsyncIterator[asyncpg.Connection]:
        if self.pool is None:
            raise ApiError(503, "starting")
        async with self.pool.acquire() as connection:
            yield connection

    @asynccontextmanager
    async def transaction(self) -> AsyncIterator[asyncpg.Connection]:
        async with self.connection() as connection, connection.transaction():
            yield connection
