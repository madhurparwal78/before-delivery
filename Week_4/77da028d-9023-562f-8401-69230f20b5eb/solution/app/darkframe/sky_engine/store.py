"""Everything the sky engine keeps in PostgreSQL (schema sky_engine) and its idempotent seed."""
from datetime import date, datetime
from typing import Any

import asyncpg

from darkframe.common.ids import seed_id
from darkframe.sky_engine.evaluation import ConditionEntry, SiteSettings

SCHEMA = """
CREATE SCHEMA IF NOT EXISTS sky_engine;
CREATE TABLE IF NOT EXISTS sky_engine.sites (
  imager_id text PRIMARY KEY, label text NOT NULL, latitude double precision NOT NULL,
  longitude double precision NOT NULL, elevation_m double precision NOT NULL, time_zone text NOT NULL,
  min_altitude_deg integer NOT NULL DEFAULT 0, push_topic text);
CREATE TABLE IF NOT EXISTS sky_engine.horizons (imager_id text PRIMARY KEY, altitudes integer[] NOT NULL);
CREATE TABLE IF NOT EXISTS sky_engine.plan_targets (
  id bigserial PRIMARY KEY, imager_id text NOT NULL, observing_date date NOT NULL, project_id text NOT NULL,
  UNIQUE (imager_id, observing_date, project_id));
CREATE TABLE IF NOT EXISTS sky_engine.conditions (
  imager_id text NOT NULL, observing_date date NOT NULL, hour_start timestamptz NOT NULL, cloud_pct integer NOT NULL,
  transparency integer NOT NULL, seeing integer NOT NULL, entered_at timestamptz NOT NULL,
  PRIMARY KEY (imager_id, observing_date, hour_start));
CREATE TABLE IF NOT EXISTS sky_engine.verdict_state (
  imager_id text NOT NULL, observing_date date NOT NULL, verdict text NOT NULL, PRIMARY KEY (imager_id, observing_date));
CREATE TABLE IF NOT EXISTS sky_engine.verdict_outbox (
  id bigserial PRIMARY KEY, imager_id text NOT NULL, observing_date date NOT NULL, topic text NOT NULL,
  title text NOT NULL, message text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), taken_at timestamptz);
CREATE TABLE IF NOT EXISTS sky_engine.meta (name text PRIMARY KEY);
"""

SEED_SITES = (
    ("ines", "Back garden", 52.2053, 0.1218, 15, "Europe/London", 25, "darkframe-ines-5d2e",
     [15] * 18 + [35] * 10 + [15] * 2 + [8] * 12 + [15] * 30),
    ("tomasz", "Rooftop", 37.1773, -3.5986, 690, "Europe/Madrid", 20, "darkframe-tomasz-91af", [10] * 72),
)
SITE_COLUMNS = "label, latitude, longitude, elevation_m, time_zone, min_altitude_deg, push_topic"


async def migrate(connection: asyncpg.Connection) -> None:
    await connection.execute(SCHEMA)
    seeded = await connection.fetchval("SELECT 1 FROM sky_engine.meta WHERE name = 'seed'")
    if seeded:
        return
    for person, label, latitude, longitude, elevation, zone, minimum, topic, mask in SEED_SITES:
        imager = seed_id(f"imager:{person}")
        await connection.execute(
            "INSERT INTO sky_engine.sites VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT DO NOTHING",
            imager, label, latitude, longitude, float(elevation), zone, minimum, topic)
        await connection.execute("INSERT INTO sky_engine.horizons VALUES ($1, $2) ON CONFLICT DO NOTHING", imager, mask)
    await connection.execute("INSERT INTO sky_engine.meta VALUES ('seed') ON CONFLICT DO NOTHING")


def site_from_row(row: asyncpg.Record | dict[str, Any]) -> SiteSettings:
    return SiteSettings(row["label"], row["latitude"], row["longitude"], row["elevation_m"], row["time_zone"],
                        row["min_altitude_deg"], row["push_topic"])


async def fetch_site(connection: asyncpg.Connection, imager: str) -> SiteSettings:
    row = await connection.fetchrow(f"SELECT {SITE_COLUMNS} FROM sky_engine.sites WHERE imager_id = $1", imager)
    return site_from_row(row)


async def insert_site(connection: asyncpg.Connection, imager: str, site: dict[str, Any]) -> None:
    await connection.execute(
        "INSERT INTO sky_engine.sites (imager_id, label, latitude, longitude, elevation_m, time_zone) "
        "VALUES ($1, $2, $3, $4, $5, $6)", imager, site["label"], site["latitude"], site["longitude"],
        site["elevation_m"], site["time_zone"])
    await connection.execute("INSERT INTO sky_engine.horizons VALUES ($1, $2)", imager, [0] * 72)


async def update_site(connection: asyncpg.Connection, imager: str, changes: dict[str, Any]) -> None:
    names = list(changes)
    assignments = ", ".join(f"{name} = ${index + 2}" for index, name in enumerate(names))
    await connection.execute(f"UPDATE sky_engine.sites SET {assignments} WHERE imager_id = $1", imager,
                             *(changes[name] for name in names))


async def fetch_horizon_mask(connection: asyncpg.Connection, imager: str) -> list[int]:
    return list(await connection.fetchval("SELECT altitudes FROM sky_engine.horizons WHERE imager_id = $1", imager))


async def save_horizon_mask(connection: asyncpg.Connection, imager: str, altitudes: list[int]) -> None:
    await connection.execute("UPDATE sky_engine.horizons SET altitudes = $2 WHERE imager_id = $1", imager, altitudes)


async def fetch_plan_project_ids(connection: asyncpg.Connection, imager: str, observing: date) -> list[str]:
    rows = await connection.fetch(
        "SELECT project_id FROM sky_engine.plan_targets WHERE imager_id = $1 AND observing_date = $2 ORDER BY id",
        imager, observing)
    return [row["project_id"] for row in rows]


async def lock_plan(connection: asyncpg.Connection, imager: str, observing: date) -> None:
    """Serialise the capacity and duplicate checks of one plan until the transaction ends."""
    await connection.execute("SELECT pg_advisory_xact_lock(hashtext($1))", f"plan:{imager}:{observing.isoformat()}")


async def add_plan_target(connection: asyncpg.Connection, imager: str, observing: date, project_id: str) -> None:
    await connection.execute(
        "INSERT INTO sky_engine.plan_targets (imager_id, observing_date, project_id) VALUES ($1, $2, $3)",
        imager, observing, project_id)


async def remove_plan_target(connection: asyncpg.Connection, imager: str, observing: date, project_id: str) -> bool:
    deleted = await connection.fetchval(
        "DELETE FROM sky_engine.plan_targets WHERE imager_id = $1 AND observing_date = $2 AND project_id = $3 "
        "RETURNING 1", imager, observing, project_id)
    return deleted is not None


async def fetch_conditions(connection: asyncpg.Connection, imager: str,
                           observing: date) -> tuple[list[ConditionEntry], datetime | None]:
    rows = await connection.fetch(
        "SELECT hour_start, cloud_pct, transparency, seeing, entered_at FROM sky_engine.conditions "
        "WHERE imager_id = $1 AND observing_date = $2 ORDER BY hour_start", imager, observing)
    entries = [ConditionEntry(row["hour_start"], row["cloud_pct"], row["transparency"], row["seeing"]) for row in rows]
    return entries, (rows[0]["entered_at"] if rows else None)


async def replace_conditions(connection: asyncpg.Connection, imager: str, observing: date,
                             entries: list[ConditionEntry], entered_at: datetime) -> None:
    await connection.execute("DELETE FROM sky_engine.conditions WHERE imager_id = $1 AND observing_date = $2",
                             imager, observing)
    await connection.executemany(
        "INSERT INTO sky_engine.conditions VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [(imager, observing, e.hour_start, e.cloud_pct, e.transparency, e.seeing, entered_at) for e in entries])


async def planned_dates(connection: asyncpg.Connection, imager: str, from_date: date) -> list[date]:
    rows = await connection.fetch(
        "SELECT observing_date FROM sky_engine.plan_targets WHERE imager_id = $1 AND observing_date >= $2 "
        "UNION SELECT observing_date FROM sky_engine.conditions WHERE imager_id = $1 AND observing_date >= $2 "
        "ORDER BY 1", imager, from_date)
    return [row["observing_date"] for row in rows]


async def record_verdict(connection: asyncpg.Connection, imager: str, observing: date, verdict: str) -> str | None:
    """Store the night's latest verdict and return the one it replaced (None the first time)."""
    await connection.execute(
        "INSERT INTO sky_engine.verdict_state VALUES ($1, $2, 'pending') ON CONFLICT DO NOTHING", imager, observing)
    previous = await connection.fetchval(
        "SELECT verdict FROM sky_engine.verdict_state WHERE imager_id = $1 AND observing_date = $2 FOR UPDATE",
        imager, observing)
    await connection.execute("UPDATE sky_engine.verdict_state SET verdict = $3 WHERE imager_id = $1 AND observing_date = $2",
                             imager, observing, verdict)
    return None if previous == "pending" else previous


async def queue_verdict_push(connection: asyncpg.Connection, imager: str, observing: date, topic: str, title: str,
                             message: str) -> None:
    await connection.execute(
        "INSERT INTO sky_engine.verdict_outbox (imager_id, observing_date, topic, title, message) "
        "VALUES ($1, $2, $3, $4, $5)", imager, observing, topic, title, message)
