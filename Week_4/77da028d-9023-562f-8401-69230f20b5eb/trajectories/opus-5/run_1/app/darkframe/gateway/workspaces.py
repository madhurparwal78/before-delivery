"""Workspace keys, the only records the gateway stores."""

from __future__ import annotations

import hashlib

import asyncpg

from .. import ids
from ..config import GATEWAY
from ..db import Database

SCHEMA_SQL = """
create schema if not exists gateway;

create table if not exists gateway.imagers (
    id text primary key,
    name text not null,
    key_hash text not null unique,
    created_at timestamptz not null default now()
);

create table if not exists gateway.seeded (
    marker text primary key,
    applied_at timestamptz not null default now()
);
"""

DATABASE = Database(GATEWAY, SCHEMA_SQL)
COOKIE_NAME = "darkframe_key"


def key_hash(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


async def create_workspace(name: str) -> tuple[str, str]:
    imager_id = ids.record_id("img")
    key = ids.workspace_key()
    await DATABASE.execute(
        "insert into gateway.imagers (id, name, key_hash) values ($1, $2, $3)",
        imager_id,
        name,
        key_hash(key),
    )
    return (imager_id, key)


async def imager_for_key(key: str) -> asyncpg.Record | None:
    return await DATABASE.fetchrow(
        "select id, name from gateway.imagers where key_hash = $1", key_hash(key)
    )


async def claim_seed(marker: str) -> bool:
    claimed = await DATABASE.fetchval(
        "insert into gateway.seeded (marker) values ($1) "
        "on conflict do nothing returning marker",
        marker,
    )
    return claimed is not None


async def insert_seed_imager(imager_id: str, name: str, key: str) -> None:
    await DATABASE.execute(
        "insert into gateway.imagers (id, name, key_hash) values ($1, $2, $3) "
        "on conflict (id) do nothing",
        imager_id,
        name,
        key_hash(key),
    )
