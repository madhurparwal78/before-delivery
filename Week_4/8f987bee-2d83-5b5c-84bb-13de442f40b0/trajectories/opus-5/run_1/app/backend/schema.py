"""The stored collections and the other state, created idempotently on every start."""

from __future__ import annotations

import asyncpg

DDL = """
CREATE TABLE IF NOT EXISTS workspaces (
    id uuid PRIMARY KEY,
    name text NOT NULL,
    plan text NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY,
    email text NOT NULL UNIQUE,
    name text NOT NULL,
    password_hash text NOT NULL,
    preferences jsonb NOT NULL,
    created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships (
    user_id uuid PRIMARY KEY REFERENCES users(id),
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    role text NOT NULL
);

CREATE TABLE IF NOT EXISTS invites (
    id uuid PRIMARY KEY,
    token_hash text NOT NULL UNIQUE,
    email text NOT NULL,
    name text NOT NULL,
    role text NOT NULL,
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    used boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS invites_email_idx ON invites (email);

CREATE TABLE IF NOT EXISTS connector_definitions (
    id text PRIMARY KEY,
    name text NOT NULL,
    slug text NOT NULL,
    type text NOT NULL,
    category text NOT NULL,
    availability text[] NOT NULL,
    runnable boolean NOT NULL,
    custom boolean NOT NULL,
    workspace_id uuid REFERENCES workspaces(id),
    version integer NOT NULL,
    manifests jsonb NOT NULL DEFAULT '{}'::jsonb,
    detected_schemas jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS sources (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    name text NOT NULL,
    definition_id text NOT NULL,
    config jsonb NOT NULL,
    api_key_secret text NOT NULL,
    created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS destinations (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    name text NOT NULL,
    definition_id text NOT NULL,
    created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS connections (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    name text NOT NULL,
    name_key text NOT NULL,
    status text NOT NULL,
    version integer NOT NULL,
    source_id uuid NOT NULL REFERENCES sources(id),
    destination_id uuid NOT NULL REFERENCES destinations(id),
    namespace_prefix text NOT NULL,
    streams jsonb NOT NULL,
    schedule jsonb NOT NULL,
    schema_change_policy text NOT NULL,
    cursors jsonb NOT NULL,
    created_at timestamptz NOT NULL,
    next_run_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS connections_name_key ON connections (workspace_id, name_key);

CREATE TABLE IF NOT EXISTS jobs (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    connection_id uuid NOT NULL REFERENCES connections(id),
    connection_version integer NOT NULL,
    definition_version integer NOT NULL,
    status text NOT NULL,
    attempts jsonb NOT NULL,
    records_committed integer NOT NULL DEFAULT 0,
    per_stream jsonb NOT NULL,
    failure_reason text,
    trigger_request_id text NOT NULL,
    started_by uuid NOT NULL REFERENCES users(id),
    settings jsonb NOT NULL,
    created_at timestamptz NOT NULL,
    started_at timestamptz,
    ended_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS jobs_one_active
    ON jobs (connection_id) WHERE status IN ('pending', 'running');
CREATE INDEX IF NOT EXISTS jobs_listing_idx ON jobs (workspace_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS job_log_lines (
    job_id uuid NOT NULL REFERENCES jobs(id),
    position integer NOT NULL,
    at timestamptz NOT NULL,
    level text NOT NULL,
    message text NOT NULL,
    PRIMARY KEY (job_id, position)
);

CREATE TABLE IF NOT EXISTS job_snapshots (
    job_id uuid NOT NULL REFERENCES jobs(id),
    stream text NOT NULL,
    records jsonb NOT NULL,
    PRIMARY KEY (job_id, stream)
);

CREATE TABLE IF NOT EXISTS audit_events (
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    seq bigint NOT NULL,
    action text NOT NULL,
    target_id text NOT NULL,
    actor_email text NOT NULL,
    at timestamptz NOT NULL,
    prev_hash text NOT NULL,
    hash text NOT NULL,
    PRIMARY KEY (workspace_id, seq)
);

CREATE TABLE IF NOT EXISTS builder_projects (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    name text NOT NULL,
    manifest jsonb NOT NULL,
    tested_streams jsonb NOT NULL,
    definition_id text REFERENCES connector_definitions(id),
    created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    key text NOT NULL,
    method text NOT NULL,
    path text NOT NULL,
    body jsonb NOT NULL,
    state text NOT NULL,
    resource_kind text,
    resource_id text,
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    PRIMARY KEY (workspace_id, key)
);

CREATE TABLE IF NOT EXISTS login_attempts (
    email text PRIMARY KEY,
    failures integer NOT NULL,
    window_started_at timestamptz NOT NULL,
    locked_until timestamptz
);

CREATE TABLE IF NOT EXISTS warehouse_tables (
    destination_id uuid NOT NULL REFERENCES destinations(id),
    name text NOT NULL,
    connection_id uuid NOT NULL REFERENCES connections(id),
    generation integer NOT NULL,
    fields jsonb NOT NULL,
    PRIMARY KEY (destination_id, name)
);

CREATE TABLE IF NOT EXISTS sample_appended_records (
    source_id uuid NOT NULL REFERENCES sources(id),
    stream text NOT NULL,
    record_id integer NOT NULL,
    updated_at timestamptz NOT NULL,
    PRIMARY KEY (source_id, stream, record_id)
);

CREATE TABLE IF NOT EXISTS sample_record_updates (
    source_id uuid NOT NULL REFERENCES sources(id),
    stream text NOT NULL,
    record_id integer NOT NULL,
    status text NOT NULL,
    updated_at timestamptz NOT NULL,
    PRIMARY KEY (source_id, stream, record_id)
);

CREATE TABLE IF NOT EXISTS sample_added_fields (
    source_id uuid NOT NULL REFERENCES sources(id),
    stream text NOT NULL,
    field text NOT NULL,
    added_seq bigserial NOT NULL,
    PRIMARY KEY (source_id, stream, field)
);

CREATE TABLE IF NOT EXISTS app_secrets (
    name text PRIMARY KEY,
    value text NOT NULL
);

CREATE TABLE IF NOT EXISTS seed_identities (
    kind text NOT NULL,
    seed_key text NOT NULL,
    identity uuid NOT NULL,
    PRIMARY KEY (kind, seed_key)
);

CREATE TABLE IF NOT EXISTS seed_state (
    only_row boolean PRIMARY KEY DEFAULT true CHECK (only_row),
    seeded_at timestamptz NOT NULL
);
"""


async def create_schema(pool: asyncpg.Pool) -> None:
    async with pool.acquire() as conn:
        await conn.execute(DDL)
