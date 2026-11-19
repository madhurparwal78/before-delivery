"""The seed: written once under fixed seed identities, never again once the seed run is recorded."""

import uuid
from typing import Any

import asyncpg

from . import sample, warehouse
from .auth import hash_password
from .catalog import BUILT_IN, SAMPLE_DEFINITION, WAREHOUSE_DEFINITION, slug
from .db import utcnow
from .sealing import seal

PASSWORD = "deku-demo-pw-2026"
DEFAULT_PREFERENCES = {"sync_sounds": False, "theme": "light"}
WORKSPACES = [("workspace:lumen", "Lumen Freight", "team"), ("workspace:outpost", "Outpost Data", "starter")]
USERS = [
    ("user:priya", "workspace:lumen", "Priya Natarajan", "admin@example.com", "admin"),
    ("user:marco", "workspace:lumen", "Marco Bell", "editor@example.com", "editor"),
    ("user:dana", "workspace:lumen", "Dana Okafor", "viewer@example.com", "viewer"),
    ("user:sasha", "workspace:outpost", "Sasha Reyes", "outsider@example.com", "admin"),
]
SEEDED_CONNECTIONS = [
    ("workspace:lumen", "lumen", "Shop Orders", "lumen-shop-key-01", "Lumen Warehouse", "Shop Orders to Warehouse",
     "shop_"),
    ("workspace:outpost", "outpost", "Outpost Events", "outpost-key-01", "Outpost Warehouse", "Outpost Sync",
     "outpost_"),
]
START_DATE = "2026-01-01"


async def run(conn: asyncpg.Connection) -> None:
    """Seed a fresh database once; a start that finds the seed run recorded writes nothing."""
    await conn.execute("SELECT pg_advisory_xact_lock(7417002)")
    if await conn.fetchval("SELECT EXISTS (SELECT 1 FROM seed_runs)"):
        return
    now = utcnow()
    ids: dict[str, uuid.UUID] = {}

    async def record_seed_identity(seed_key: str, entity_id: Any) -> None:
        await conn.execute("INSERT INTO seed_identities (seed_key, entity_id) VALUES ($1, $2)", seed_key,
                           str(entity_id))

    for name, kind, category, availability, runnable in BUILT_IN:
        await conn.execute(
            """INSERT INTO connector_definitions (id, name, slug, type, category, availability, runnable, custom,
                                                  version, created_at)
               VALUES ($1, $2, $1, $3, $4, $5, $6, false, 1, $7)""",
            slug(name), name, kind, category, list(availability), runnable, now)
        await record_seed_identity(f"definition:{slug(name)}", slug(name))
    for seed_key, name, plan in WORKSPACES:
        ids[seed_key] = uuid.uuid4()
        await conn.execute("INSERT INTO workspaces (id, name, plan, created_at) VALUES ($1, $2, $3, $4)",
                           ids[seed_key], name, plan, now)
        await record_seed_identity(seed_key, ids[seed_key])
    for seed_key, workspace_key, name, email, role in USERS:
        ids[seed_key] = uuid.uuid4()
        await conn.execute("INSERT INTO users (id, email, name, password_hash, preferences, created_at) "
                           "VALUES ($1, $2, $3, $4, $5, $6)",
                           ids[seed_key], email, name, await hash_password(PASSWORD), DEFAULT_PREFERENCES, now)
        await conn.execute("INSERT INTO memberships (user_id, workspace_id, role, created_at) VALUES ($1, $2, $3, $4)",
                           ids[seed_key], ids[workspace_key], role, now)
        await record_seed_identity(seed_key, ids[seed_key])
        await record_seed_identity(f"membership:{seed_key}", ids[seed_key])
    for workspace_key, tag, source_name, api_key, destination_name, connection_name, prefix in SEEDED_CONNECTIONS:
        workspace_id = ids[workspace_key]
        source_id, destination_id, connection_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        await conn.execute("INSERT INTO sources (id, workspace_id, name, definition_id, config, sealed_api_key, "
                           "created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
                           source_id, workspace_id, source_name, SAMPLE_DEFINITION, {"start_date": START_DATE},
                           seal(api_key), now)
        await conn.execute("INSERT INTO destinations (id, workspace_id, name, definition_id, created_at) "
                           "VALUES ($1, $2, $3, $4, $5)", destination_id, workspace_id, destination_name,
                           WAREHOUSE_DEFINITION, now)
        await warehouse.create_schema(conn, destination_id)
        streams = [{"name": name, "selected": True, "sync_mode": "full_refresh_overwrite",
                    "cursor_field": sample.CURSOR_FIELD, "primary_key": ["id"],
                    "known_fields": list(sample.BASE_FIELDS[name])} for name in sample.STREAMS]
        await conn.execute(
            """INSERT INTO connections (id, workspace_id, name, status, version, source_id, destination_id,
                                        namespace_prefix, streams, schedule, schema_change_policy, cursors, created_at)
               VALUES ($1, $2, $3, 'active', 1, $4, $5, $6, $7, $8, 'propagate', $9, $10)""",
            connection_id, workspace_id, connection_name, source_id, destination_id, prefix, streams,
            {"type": "manual"}, {name: None for name in sample.STREAMS}, now)
        await record_seed_identity(f"source:{tag}", source_id)
        await record_seed_identity(f"destination:{tag}", destination_id)
        await record_seed_identity(f"connection:{tag}", connection_id)
    await conn.execute("INSERT INTO seed_runs (id, ran_at) VALUES (1, $1)", now)
