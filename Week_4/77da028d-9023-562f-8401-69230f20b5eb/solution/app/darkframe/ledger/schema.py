"""Schema `ledger` and its idempotent seed. Seed masters are recorded here and uploaded by `seed_masters`."""
import hashlib
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import asyncpg

from darkframe.common.ids import seed_id
from darkframe.common.s3 import ObjectStore
from darkframe.ledger.entries import post_allotment, post_log

SCHEMA = """
CREATE SCHEMA IF NOT EXISTS ledger;
CREATE TABLE IF NOT EXISTS ledger.projects (
  id text PRIMARY KEY, imager_id text NOT NULL, name text NOT NULL, target_name text NOT NULL,
  ra_deg double precision NOT NULL, dec_deg double precision NOT NULL, state text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS projects_imager ON ledger.projects (imager_id);
CREATE TABLE IF NOT EXISTS ledger.entries (
  seq bigserial PRIMARY KEY, id text NOT NULL UNIQUE, movement_id text NOT NULL, movement_kind text NOT NULL,
  project_id text NOT NULL, filter text NOT NULL, account text NOT NULL, seconds integer NOT NULL,
  session_id text, batch_id text, reverses_movement_id text, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS entries_project ON ledger.entries (project_id);
CREATE INDEX IF NOT EXISTS entries_movement ON ledger.entries (movement_id);
CREATE INDEX IF NOT EXISTS entries_reverses ON ledger.entries (reverses_movement_id);
CREATE TABLE IF NOT EXISTS ledger.sessions (
  seq bigserial PRIMARY KEY, id text NOT NULL UNIQUE, imager_id text NOT NULL, project_id text NOT NULL,
  state text NOT NULL, previous_state text, observing_date date NOT NULL, started_at timestamptz,
  logged_at timestamptz, notes text NOT NULL DEFAULT '', lock_token text, lock_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS sessions_imager ON ledger.sessions (imager_id);
CREATE TABLE IF NOT EXISTS ledger.batches (
  seq bigserial PRIMARY KEY, id text NOT NULL UNIQUE, session_id text NOT NULL, imager_id text NOT NULL,
  filter text NOT NULL, sub_count integer NOT NULL, exposure_s integer NOT NULL, camera text NOT NULL,
  gain integer NOT NULL, offset_value integer NOT NULL, temperature_c double precision NOT NULL,
  binning integer NOT NULL);
CREATE INDEX IF NOT EXISTS batches_session ON ledger.batches (session_id);
CREATE TABLE IF NOT EXISTS ledger.batch_calibrations (
  batch_id text NOT NULL, kind text NOT NULL, calibration_set_id text NOT NULL, PRIMARY KEY (batch_id, kind));
CREATE TABLE IF NOT EXISTS ledger.frames (
  seq bigserial PRIMARY KEY, id text NOT NULL UNIQUE, imager_id text NOT NULL, session_id text NOT NULL,
  batch_id text NOT NULL, name text NOT NULL, size_bytes bigint NOT NULL, content_type text NOT NULL,
  sha256 text NOT NULL, object_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, name));
CREATE TABLE IF NOT EXISTS ledger.calibration_sets (
  seq bigserial PRIMARY KEY, id text NOT NULL UNIQUE, imager_id text NOT NULL, kind text NOT NULL,
  status text NOT NULL, version integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS calibration_sets_imager ON ledger.calibration_sets (imager_id);
CREATE TABLE IF NOT EXISTS ledger.calibration_versions (
  set_id text NOT NULL, version integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  name text NOT NULL, camera text NOT NULL, gain integer NOT NULL, offset_value integer NOT NULL, exposure_s integer,
  temperature_c double precision NOT NULL, binning integer NOT NULL, filter text, frame_count integer NOT NULL,
  captured_on date NOT NULL, master_filename text, master_size bigint, master_sha256 text, master_key text,
  master_content_type text, PRIMARY KEY (set_id, version));
CREATE TABLE IF NOT EXISTS ledger.shares (
  project_id text PRIMARY KEY, token text NOT NULL UNIQUE, imager_id text NOT NULL, expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS ledger.idempotency_keys (
  imager_id text NOT NULL, key text NOT NULL, request_hash text NOT NULL, status integer NOT NULL,
  response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (imager_id, key));
CREATE TABLE IF NOT EXISTS ledger.meta (name text PRIMARY KEY);
"""

SEED_MASTER_PREFIX = "DARKFRAME-SEED-MASTER "
SEED_MASTER_FILENAME = "master.fits"
SEED_MASTER_TYPE = "application/octet-stream"

INES = ("ines", "Europe/London")
TOMASZ = ("tomasz", "Europe/Madrid")

# (key, person, name, target, ra, dec, state, {filter: planned seconds})
SEED_PROJECTS = (
    ("heart", "ines", "Heart Nebula in SHO", "IC 1805", 38.175, 61.45, "active", {"Ha": 36000, "OIII": 36000, "SII": 36000}),
    ("andromeda", "ines", "Andromeda LRGB", "M31", 10.6847, 41.2690, "active", {"L": 21600, "R": 7200, "G": 7200, "B": 7200}),
    ("veil", "ines", "Veil bicolour", "NGC 6960", 311.4083, 30.7167, "draft", {"Ha": 28800, "OIII": 28800}),
    ("orion", "tomasz", "Orion Nebula HaRGB", "M42", 83.8221, -5.3911, "active", {"Ha": 14400, "R": 3600, "G": 3600, "B": 3600}),
)
# (key, person, name, kind, camera, gain, offset, exposure, temperature, binning, filter, frames, age in days)
SEED_SETS = (
    ("darks300", "ines", "Darks 300 s gain 100 at -10 C", "dark", "Umbra 26M", 100, 50, 300, -10.0, 1, None, 40, 75),
    ("darks180", "ines", "Darks 180 s gain 100 at -10 C (old)", "dark", "Umbra 26M", 100, 50, 180, -10.0, 1, None, 40, 200),
    ("flatsha", "ines", "Flats Ha", "flat", "Umbra 26M", 100, 50, None, -10.0, 1, "Ha", 30, 10),
    ("darks120", "tomasz", "Darks 120 s gain 0 at 0 C", "dark", "Umbra 6M", 0, 10, 120, 0.0, 1, None, 25, 30),
)
# (key, person, project, observing date, started at, notes, filter, subs, exposure, camera, gain, offset, temperature, links)
SEED_SESSIONS = (
    ("ines-1", "ines", "heart", date(2026, 10, 14), "2026-10-14T21:05:00+01:00",
     "Oak blocked the east until 22:40. Dew heater on 3.", "Ha", 60, 300, "Umbra 26M", 100, 50, -10.0, ("darks300", "flatsha")),
    ("tomasz-1", "tomasz", "orion", date(2026, 10, 20), "2026-10-21T01:10:00+02:00",
     "Neighbour's floodlight on until 01:00.", "R", 30, 120, "Umbra 6M", 0, 10, 0.0, ()),
)


def imager_of(person: str) -> str:
    return seed_id(f"imager:{person}")


def seed_master_bytes(name: str) -> bytes:
    return (SEED_MASTER_PREFIX + name).encode()


def seed_master_key(person: str, set_key: str) -> str:
    return f"calibration/{imager_of(person)}/{seed_id('set:' + set_key)}/v1/{SEED_MASTER_FILENAME}"


async def migrate(connection: asyncpg.Connection) -> None:
    await connection.execute(SCHEMA)
    if await connection.fetchval("SELECT 1 FROM ledger.meta WHERE name = 'seed'"):
        return
    zones = dict((INES, TOMASZ))
    for key, person, name, target, ra, dec, state, planned in SEED_PROJECTS:
        project = seed_id(f"project:{key}")
        await connection.execute("INSERT INTO ledger.projects (id, imager_id, name, target_name, ra_deg, dec_deg, state) "
                                 "VALUES ($1, $2, $3, $4, $5, $6, $7)", project, imager_of(person), name, target, ra, dec, state)
        for filter_name, seconds in planned.items():
            await post_allotment(connection, project, filter_name, seconds, seed_id(f"allot:{key}:{filter_name}"))
    for key, person, name, kind, camera, gain, offset, exposure, temperature, binning, filter_name, frames, age in SEED_SETS:
        today = datetime.now(UTC).astimezone(ZoneInfo(zones[person])).date()
        set_id = seed_id(f"set:{key}")
        master_bytes = seed_master_bytes(name)
        await connection.execute(
            "INSERT INTO ledger.calibration_sets (id, imager_id, kind, status, version) VALUES ($1, $2, $3, 'ready', 1)",
            set_id, imager_of(person), kind)
        await connection.execute(
            "INSERT INTO ledger.calibration_versions (set_id, version, name, camera, gain, offset_value, exposure_s, "
            "temperature_c, binning, filter, frame_count, captured_on, master_filename, master_size, master_sha256, "
            "master_key, master_content_type) VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)",
            set_id, name, camera, gain, offset, exposure, temperature, binning, filter_name, frames,
            today - timedelta(days=age), SEED_MASTER_FILENAME, len(master_bytes), hashlib.sha256(master_bytes).hexdigest(),
            seed_master_key(person, key), SEED_MASTER_TYPE)
    for key, person, project_key, observing, started, notes, filter_name, subs, exposure, camera, gain, offset, temperature, links in SEED_SESSIONS:
        session, batch, project = seed_id(f"session:{key}"), seed_id(f"batch:{key}"), seed_id(f"project:{project_key}")
        await connection.execute(
            "INSERT INTO ledger.sessions (id, imager_id, project_id, state, observing_date, started_at, logged_at, notes) "
            "VALUES ($1, $2, $3, 'logged', $4, $5, now(), $6)", session, imager_of(person), project, observing,
            datetime.fromisoformat(started), notes)
        await connection.execute(
            "INSERT INTO ledger.batches (id, session_id, imager_id, filter, sub_count, exposure_s, camera, gain, "
            "offset_value, temperature_c, binning) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1)",
            batch, session, imager_of(person), filter_name, subs, exposure, camera, gain, offset, temperature)
        for linked in links:
            kind = "dark" if linked.startswith("darks") else "flat"
            await connection.execute("INSERT INTO ledger.batch_calibrations VALUES ($1, $2, $3)", batch, kind,
                                     seed_id(f"set:{linked}"))
        await post_log(connection, project, session, batch, filter_name, subs * exposure, seed_id(f"log:{key}"))
    await connection.execute("INSERT INTO ledger.meta VALUES ('seed')")


async def seed_masters(objects: ObjectStore) -> None:
    """Upload the seeded masters; retried by the caller until the object store answers."""
    for key, person, name, *_ in SEED_SETS:
        await objects.put(seed_master_key(person, key), seed_master_bytes(name), SEED_MASTER_TYPE)
