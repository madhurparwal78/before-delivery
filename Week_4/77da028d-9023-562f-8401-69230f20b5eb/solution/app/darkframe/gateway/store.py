"""Schema `gateway`: workspace keys only."""
import asyncpg

from darkframe.common.ids import seed_id

SCHEMA = """
CREATE SCHEMA IF NOT EXISTS gateway;
CREATE TABLE IF NOT EXISTS gateway.workspaces (
  imager_id text PRIMARY KEY, name text NOT NULL, key text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS gateway.meta (name text PRIMARY KEY);
"""
SEED_WORKSPACES = (("ines", "Ines Okafor", "dfk_ines_7c41a9e2"), ("tomasz", "Tomasz Brandt", "dfk_tomasz_3e8b52d0"))


async def migrate(connection: asyncpg.Connection) -> None:
    await connection.execute(SCHEMA)
    if await connection.fetchval("SELECT 1 FROM gateway.meta WHERE name = 'seed'"):
        return
    for person, name, key in SEED_WORKSPACES:
        await connection.execute("INSERT INTO gateway.workspaces (imager_id, name, key) VALUES ($1, $2, $3) "
                                 "ON CONFLICT DO NOTHING", seed_id(f"imager:{person}"), name, key)
    await connection.execute("INSERT INTO gateway.meta VALUES ('seed')")


async def find_workspace(connection: asyncpg.Connection, key: str) -> asyncpg.Record | None:
    return await connection.fetchrow("SELECT imager_id, name FROM gateway.workspaces WHERE key = $1", key)


async def add_workspace(connection: asyncpg.Connection, imager: str, name: str, key: str) -> None:
    await connection.execute("INSERT INTO gateway.workspaces (imager_id, name, key) VALUES ($1, $2, $3)", imager, name, key)
