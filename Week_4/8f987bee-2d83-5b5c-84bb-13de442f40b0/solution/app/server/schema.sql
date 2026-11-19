-- Wayline schema: created on every start, so it is written to be re-run safely.

CREATE TABLE IF NOT EXISTS workspaces (
    id uuid PRIMARY KEY,
    name text NOT NULL,
    plan text NOT NULL CHECK (plan IN ('starter', 'team', 'scale', 'private')),
    created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY,
    email text NOT NULL UNIQUE CHECK (email = lower(email)),
    name text NOT NULL,
    password_hash text NOT NULL,
    preferences jsonb NOT NULL,
    created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships (
    user_id uuid PRIMARY KEY REFERENCES users (id),
    workspace_id uuid NOT NULL REFERENCES workspaces (id),
    role text NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
    created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS invites (
    id uuid PRIMARY KEY,
    token_hash text NOT NULL UNIQUE,
    email text NOT NULL CHECK (email = lower(email)),
    name text NOT NULL,
    role text NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
    workspace_id uuid NOT NULL REFERENCES workspaces (id),
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    used boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users (id),
    created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS sign_in_attempts (
    email text PRIMARY KEY,
    failures timestamptz[] NOT NULL DEFAULT '{}',
    locked_until timestamptz
);

CREATE TABLE IF NOT EXISTS connector_definitions (
    id text PRIMARY KEY,
    name text NOT NULL,
    slug text NOT NULL,
    type text NOT NULL CHECK (type IN ('source', 'destination')),
    category text NOT NULL,
    availability text[] NOT NULL,
    runnable boolean NOT NULL,
    custom boolean NOT NULL,
    version integer NOT NULL,
    workspace_id uuid REFERENCES workspaces (id),
    versions jsonb,
    created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces (id),
    name text NOT NULL,
    definition_id text NOT NULL REFERENCES connector_definitions (id),
    config jsonb NOT NULL,
    sealed_api_key bytea NOT NULL,
    created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS destinations (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces (id),
    name text NOT NULL,
    definition_id text NOT NULL REFERENCES connector_definitions (id),
    created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS connections (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces (id),
    name text NOT NULL,
    status text NOT NULL CHECK (status IN ('active', 'inactive')),
    version integer NOT NULL CHECK (version >= 1),
    source_id uuid NOT NULL REFERENCES sources (id),
    destination_id uuid NOT NULL REFERENCES destinations (id),
    namespace_prefix text NOT NULL,
    streams jsonb NOT NULL,
    schedule jsonb NOT NULL,
    schema_change_policy text NOT NULL CHECK (schema_change_policy IN ('propagate', 'ignore', 'pause')),
    cursors jsonb NOT NULL,
    schema_paused boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS connections_name_unique ON connections (workspace_id, lower(name));

CREATE TABLE IF NOT EXISTS jobs (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces (id),
    connection_id uuid NOT NULL REFERENCES connections (id),
    connection_version integer NOT NULL,
    definition_version integer NOT NULL,
    status text NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'cancelled')),
    attempts jsonb NOT NULL,
    records_committed integer NOT NULL DEFAULT 0,
    per_stream jsonb NOT NULL,
    failure_reason text,
    trigger_request_id text NOT NULL,
    started_by uuid NOT NULL REFERENCES users (id),
    settings jsonb NOT NULL,
    snapshot_seq bigint,
    created_at timestamptz NOT NULL,
    started_at timestamptz,
    ended_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS jobs_one_active ON jobs (connection_id) WHERE status IN ('pending', 'running');
CREATE INDEX IF NOT EXISTS jobs_listing ON jobs (workspace_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS job_logs (
    job_id uuid NOT NULL REFERENCES jobs (id),
    seq integer NOT NULL,
    at timestamptz NOT NULL,
    level text NOT NULL CHECK (level IN ('info', 'error')),
    message text NOT NULL,
    PRIMARY KEY (job_id, seq)
);

CREATE TABLE IF NOT EXISTS audit_events (
    workspace_id uuid NOT NULL REFERENCES workspaces (id),
    seq integer NOT NULL,
    action text NOT NULL,
    target_id text NOT NULL,
    actor_email text NOT NULL,
    at timestamptz NOT NULL,
    prev_hash text NOT NULL,
    hash text NOT NULL,
    PRIMARY KEY (workspace_id, seq)
);

CREATE OR REPLACE FUNCTION audit_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'audit events are append-only';
END
$$;
CREATE OR REPLACE TRIGGER audit_events_append_only
    BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();
CREATE OR REPLACE TRIGGER audit_events_no_truncate
    BEFORE TRUNCATE ON audit_events FOR EACH STATEMENT EXECUTE FUNCTION audit_events_append_only();

CREATE TABLE IF NOT EXISTS builder_projects (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces (id),
    name text NOT NULL,
    manifest jsonb NOT NULL,
    tested_streams jsonb NOT NULL,
    definition_id text REFERENCES connector_definitions (id),
    created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
    workspace_id uuid NOT NULL REFERENCES workspaces (id),
    key text NOT NULL,
    fingerprint text NOT NULL,
    resource_kind text NOT NULL CHECK (resource_kind IN ('connection', 'job')),
    resource_id uuid NOT NULL,
    recorded_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    PRIMARY KEY (workspace_id, key)
);

CREATE TABLE IF NOT EXISTS warehouse_tables (
    destination_id uuid NOT NULL REFERENCES destinations (id),
    name text NOT NULL,
    connection_id uuid NOT NULL REFERENCES connections (id),
    generation integer NOT NULL,
    columns jsonb NOT NULL,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (destination_id, name)
);

CREATE TABLE IF NOT EXISTS sample_events (
    id bigserial PRIMARY KEY,
    source_id uuid NOT NULL REFERENCES sources (id),
    stream text NOT NULL,
    kind text NOT NULL CHECK (kind IN ('append', 'update_ids', 'add_field')),
    payload jsonb NOT NULL,
    at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sample_events_source ON sample_events (source_id, id);

CREATE TABLE IF NOT EXISTS seed_identities (
    seed_key text PRIMARY KEY,
    entity_id text NOT NULL
);

CREATE TABLE IF NOT EXISTS seed_runs (
    id integer PRIMARY KEY CHECK (id = 1),
    ran_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS app_secrets (
    name text PRIMARY KEY,
    value bytea NOT NULL
);
