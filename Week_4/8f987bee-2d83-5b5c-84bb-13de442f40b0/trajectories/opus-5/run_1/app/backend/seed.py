"""The baseline data, written once under a fixed seed identity."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import asyncpg

from .catalog import BUILT_IN_DEFINITIONS, SAMPLE_COMMERCE_ID, WAYLINE_WAREHOUSE_ID
from .sample_source import BASE_FIELDS, STREAM_NAMES
from .security import hash_password, protect_secret

SEED_NAMESPACE = uuid.UUID("5f3b6c2e-6a7d-4f21-9d84-3a2f1b7c9e40")
SEED_PASSWORD = "deku-demo-pw-2026"

LUMEN = "workspace:lumen-freight"
OUTPOST = "workspace:outpost-data"

SEEDED_USERS = (
    ("user:lumen-admin", "admin@example.com", "Priya Natarajan", LUMEN, "admin"),
    ("user:lumen-editor", "editor@example.com", "Marco Bell", LUMEN, "editor"),
    ("user:lumen-viewer", "viewer@example.com", "Dana Okafor", LUMEN, "viewer"),
    ("user:outpost-admin", "outsider@example.com", "Sasha Reyes", OUTPOST, "admin"),
)

SEEDED_WORKSPACES = (
    (LUMEN, "Lumen Freight", "team"),
    (OUTPOST, "Outpost Data", "starter"),
)

SEEDED_PIPELINES = (
    (LUMEN, "Shop Orders", "lumen-shop-key-01", "Lumen Warehouse", "Shop Orders to Warehouse", "shop_"),
    (OUTPOST, "Outpost Events", "outpost-key-01", "Outpost Warehouse", "Outpost Sync", "outpost_"),
)

DEFAULT_PREFERENCES = {"sync_sounds": False, "theme": "light"}


def seed_identity(kind: str, seed_key: str) -> uuid.UUID:
    """A seeded row's identity, fixed by its seed key and never by a value a person can change."""
    return uuid.uuid5(SEED_NAMESPACE, f"{kind}:{seed_key}")


async def already_seeded(conn: asyncpg.Connection) -> bool:
    return await conn.fetchval("SELECT true FROM seed_state") is not None


async def run_seed(conn: asyncpg.Connection) -> None:
    now = datetime.now(timezone.utc)
    async with conn.transaction():
        if await already_seeded(conn):
            return
        for definition in BUILT_IN_DEFINITIONS:
            await conn.execute(
                """
                INSERT INTO connector_definitions
                    (id, name, slug, type, category, availability, runnable, custom, workspace_id, version)
                VALUES ($1, $2, $3, $4, $5, $6, $7, false, NULL, 1)
                """,
                definition.id,
                definition.name,
                definition.slug,
                definition.type,
                definition.category,
                list(definition.availability),
                definition.runnable,
            )
        for seed_key, name, plan in SEEDED_WORKSPACES:
            await conn.execute(
                "INSERT INTO workspaces (id, name, plan) VALUES ($1, $2, $3)",
                seed_identity("workspace", seed_key),
                name,
                plan,
            )
        password_hash = hash_password(SEED_PASSWORD)
        for seed_key, email, name, workspace_key, role in SEEDED_USERS:
            user_id = seed_identity("user", seed_key)
            await conn.execute(
                """
                INSERT INTO users (id, email, name, password_hash, preferences, created_at)
                VALUES ($1, $2, $3, $4, $5, $6)
                """,
                user_id,
                email,
                name,
                password_hash,
                DEFAULT_PREFERENCES,
                now,
            )
            await conn.execute(
                "INSERT INTO memberships (user_id, workspace_id, role) VALUES ($1, $2, $3)",
                user_id,
                seed_identity("workspace", workspace_key),
                role,
            )
        for workspace_key, source_name, api_key, destination_name, connection_name, prefix in SEEDED_PIPELINES:
            workspace_id = seed_identity("workspace", workspace_key)
            source_id = seed_identity("source", f"{workspace_key}:{source_name}")
            destination_id = seed_identity("destination", f"{workspace_key}:{destination_name}")
            connection_id = seed_identity("connection", f"{workspace_key}:{connection_name}")
            await conn.execute(
                """
                INSERT INTO sources (id, workspace_id, name, definition_id, config, api_key_secret, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                """,
                source_id,
                workspace_id,
                source_name,
                SAMPLE_COMMERCE_ID,
                {"start_date": "2026-01-01"},
                protect_secret(api_key),
                now,
            )
            await conn.execute(
                """
                INSERT INTO destinations (id, workspace_id, name, definition_id, created_at)
                VALUES ($1, $2, $3, $4, $5)
                """,
                destination_id,
                workspace_id,
                destination_name,
                WAYLINE_WAREHOUSE_ID,
                now,
            )
            streams = [
                {
                    "name": stream,
                    "selected": True,
                    "sync_mode": "full_refresh_overwrite",
                    "cursor_field": None,
                    "primary_key": ["id"],
                    "known_fields": list(BASE_FIELDS[stream]),
                }
                for stream in STREAM_NAMES
            ]
            await conn.execute(
                """
                INSERT INTO connections (
                    id, workspace_id, name, name_key, status, version, source_id, destination_id,
                    namespace_prefix, streams, schedule, schema_change_policy, cursors, created_at, next_run_at
                )
                VALUES ($1, $2, $3, $4, 'active', 1, $5, $6, $7, $8, $9, 'propagate', $10, $11, NULL)
                """,
                connection_id,
                workspace_id,
                connection_name,
                connection_name.strip().casefold(),
                source_id,
                destination_id,
                prefix,
                streams,
                {"type": "manual"},
                {stream: None for stream in STREAM_NAMES},
                now,
            )
        for kind, seed_key in _identity_rows():
            await conn.execute(
                "INSERT INTO seed_identities (kind, seed_key, identity) VALUES ($1, $2, $3)",
                kind,
                seed_key,
                seed_identity(kind, seed_key),
            )
        await conn.execute("INSERT INTO seed_state (seeded_at) VALUES ($1)", now)


def _identity_rows() -> list[tuple[str, str]]:
    rows: list[tuple[str, str]] = [("workspace", key) for key, _, _ in SEEDED_WORKSPACES]
    rows.extend(("user", key) for key, *_ in SEEDED_USERS)
    for workspace_key, source_name, _, destination_name, connection_name, _ in SEEDED_PIPELINES:
        rows.append(("source", f"{workspace_key}:{source_name}"))
        rows.append(("destination", f"{workspace_key}:{destination_name}"))
        rows.append(("connection", f"{workspace_key}:{connection_name}"))
    return rows
