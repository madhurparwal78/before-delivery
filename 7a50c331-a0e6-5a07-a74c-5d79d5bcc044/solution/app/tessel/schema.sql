CREATE TABLE IF NOT EXISTS organizations (
    id         bigserial PRIMARY KEY,
    name       text NOT NULL UNIQUE,
    plan       text NOT NULL CHECK (plan IN ('ship', 'scale')),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS members (
    id              bigserial PRIMARY KEY,
    organization_id bigint NOT NULL REFERENCES organizations(id),
    email           text NOT NULL UNIQUE CHECK (email = lower(email)),
    role            text NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
    password_hash   text NOT NULL,
    totp_secret     text,
    totp_enabled    boolean NOT NULL DEFAULT false,
    totp_last_step  bigint NOT NULL DEFAULT 0,
    created_at      timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS recovery_codes (
    member_id bigint NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    digest    text NOT NULL,
    used_at   timestamptz,
    PRIMARY KEY (member_id, digest)
);

CREATE TABLE IF NOT EXISTS sessions (
    id           bigserial PRIMARY KEY,
    member_id    bigint NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    token_digest text NOT NULL UNIQUE,
    created_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
    revoked_at   timestamptz
);

CREATE TABLE IF NOT EXISTS sign_in_failures (
    id    bigserial PRIMARY KEY,
    email text NOT NULL,
    at    timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS sign_in_failures_email ON sign_in_failures (email, at);

CREATE TABLE IF NOT EXISTS reset_tokens (
    digest       text PRIMARY KEY,
    member_id    bigint NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    created_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
    used_at      timestamptz,
    cancelled_at timestamptz
);

CREATE TABLE IF NOT EXISTS databases (
    id               bigserial PRIMARY KEY,
    organization_id  bigint NOT NULL REFERENCES organizations(id),
    name             text NOT NULL CHECK (name ~ '^[a-z][a-z0-9_]{2,31}$'),
    created_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
    last_lsn         integer NOT NULL DEFAULT 0,
    indexed_lsn      integer NOT NULL DEFAULT 0 CHECK (indexed_lsn <= last_lsn),
    index_generation integer NOT NULL DEFAULT 0,
    UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS api_keys (
    id              bigserial PRIMARY KEY,
    organization_id bigint NOT NULL REFERENCES organizations(id),
    name            text NOT NULL,
    role            text NOT NULL CHECK (role IN ('editor', 'viewer')),
    prefix          text NOT NULL,
    secret_digest   text NOT NULL UNIQUE,
    scoped          boolean NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
    last_used_at    timestamptz,
    rotated_at      timestamptz,
    revoked_at      timestamptz
);

CREATE TABLE IF NOT EXISTS api_key_databases (
    key_id      bigint NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
    database_id bigint NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
    PRIMARY KEY (key_id, database_id)
);

CREATE TABLE IF NOT EXISTS key_queries (
    id     bigserial PRIMARY KEY,
    key_id bigint NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
    at     timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS key_queries_key ON key_queries (key_id, at);

CREATE TABLE IF NOT EXISTS collections (
    database_id bigint NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
    name        text NOT NULL CHECK (name ~ '^[a-z][a-z0-9_]{2,31}$'),
    PRIMARY KEY (database_id, name)
);

CREATE TABLE IF NOT EXISTS sources (
    database_id bigint NOT NULL,
    collection  text NOT NULL,
    id          text NOT NULL,
    title       text NOT NULL,
    text        text NOT NULL,
    version     integer NOT NULL,
    max_version integer NOT NULL,
    token_count integer NOT NULL,
    ingested_at timestamptz NOT NULL,
    lsn         integer NOT NULL,
    deleted     boolean NOT NULL DEFAULT false,
    PRIMARY KEY (database_id, collection, id),
    FOREIGN KEY (database_id, collection) REFERENCES collections(database_id, name) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS source_versions (
    id              bigserial PRIMARY KEY,
    organization_id bigint NOT NULL REFERENCES organizations(id),
    database_id     bigint,
    collection      text,
    source_id       text,
    version         integer,
    lsn             integer,
    token_count     integer NOT NULL,
    ingested_at     timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS source_versions_org ON source_versions (organization_id, ingested_at);
CREATE INDEX IF NOT EXISTS source_versions_db ON source_versions (database_id);

CREATE TABLE IF NOT EXISTS facts (
    id          bigserial PRIMARY KEY,
    database_id bigint NOT NULL,
    collection  text NOT NULL,
    source_id   text NOT NULL,
    version     integer NOT NULL,
    lsn         integer NOT NULL,
    position    integer NOT NULL,
    subject     text NOT NULL,
    subject_key text NOT NULL,
    predicate   text NOT NULL CHECK (predicate ~ '^[A-Z][A-Z0-9_]{1,31}$'),
    object      text NOT NULL,
    object_key  text NOT NULL,
    valid_from  timestamptz NOT NULL,
    reason      text NOT NULL,
    FOREIGN KEY (database_id, collection, source_id) REFERENCES sources(database_id, collection, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS facts_source ON facts (database_id, collection, source_id);

CREATE TABLE IF NOT EXISTS wal_entries (
    database_id bigint NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
    lsn         integer NOT NULL CHECK (lsn >= 1),
    kind        text NOT NULL CHECK (kind IN ('ingest', 'delete', 'restore')),
    collection  text NOT NULL,
    source_id   text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (database_id, lsn)
);

CREATE TABLE IF NOT EXISTS query_records (
    request_id      uuid PRIMARY KEY,
    organization_id bigint NOT NULL REFERENCES organizations(id),
    database_id     bigint NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
    created_at      timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS feedback (
    id              bigserial PRIMARY KEY,
    request_id      uuid NOT NULL REFERENCES query_records(request_id) ON DELETE CASCADE,
    organization_id bigint NOT NULL REFERENCES organizations(id),
    rating          text CHECK (rating IN ('positive', 'negative', 'neutral')),
    feedback        text,
    source          text NOT NULL CHECK (source IN ('user', 'agent')),
    ground_truth    jsonb,
    metadata        jsonb,
    created_at      timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS feedback_org ON feedback (organization_id, created_at);

CREATE TABLE IF NOT EXISTS contact_messages (
    id         bigserial PRIMARY KEY,
    email      text NOT NULL,
    message    text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS contact_messages_email ON contact_messages (lower(email), created_at);

CREATE TABLE IF NOT EXISTS audit_events (
    id              bigserial PRIMARY KEY,
    organization_id bigint NOT NULL REFERENCES organizations(id),
    at              timestamptz NOT NULL DEFAULT clock_timestamp(),
    actor           text NOT NULL,
    action          text NOT NULL,
    target          text NOT NULL,
    detail          text NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_events_page ON audit_events (organization_id, at DESC, id DESC);
CREATE INDEX IF NOT EXISTS audit_events_actor ON audit_events (organization_id, lower(actor), at DESC, id DESC);

CREATE TABLE IF NOT EXISTS export_jobs (
    id              text PRIMARY KEY,
    organization_id bigint NOT NULL REFERENCES organizations(id),
    database_id     bigint NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
    lsn             integer NOT NULL,
    requested_by    text NOT NULL,
    requested_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
    document        text NOT NULL,
    sha256          text NOT NULL,
    mailed_at       timestamptz
);

CREATE TABLE IF NOT EXISTS idempotency_records (
    organization_id bigint NOT NULL REFERENCES organizations(id),
    route           text NOT NULL,
    key             text NOT NULL,
    request_digest  text NOT NULL,
    status          integer NOT NULL,
    data            text NOT NULL,
    database_id     bigint REFERENCES databases(id) ON DELETE CASCADE,
    created_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (organization_id, route, key)
)
