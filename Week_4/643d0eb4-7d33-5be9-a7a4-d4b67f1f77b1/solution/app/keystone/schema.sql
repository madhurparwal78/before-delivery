-- Keystone Tables: applied on every start; every statement is idempotent.

CREATE TABLE IF NOT EXISTS tiers (
    id bigserial PRIMARY KEY,
    name text NOT NULL UNIQUE,
    position integer NOT NULL,
    row_allowance integer NOT NULL,
    stored_megabytes integer NOT NULL,
    content_allowance_kilobytes integer NOT NULL,
    view_allowance integer NOT NULL,
    retention text NOT NULL,
    retention_periods integer
);

CREATE TABLE IF NOT EXISTS departments (
    id bigserial PRIMARY KEY,
    slug text NOT NULL UNIQUE,
    name text NOT NULL,
    tier text NOT NULL REFERENCES tiers (name)
);

CREATE TABLE IF NOT EXISTS accounts (
    id bigserial PRIMARY KEY,
    email text NOT NULL UNIQUE,
    display_name text NOT NULL,
    department text NOT NULL,
    tier text NOT NULL,
    password_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS role_grants (
    id bigserial PRIMARY KEY,
    account text NOT NULL,
    department text NOT NULL,
    role text NOT NULL CHECK (role IN ('viewer', 'analyst', 'editor', 'steward')),
    authorises_from timestamptz NOT NULL DEFAULT now(),
    UNIQUE (account, department)
);

CREATE TABLE IF NOT EXISTS department_grants (
    id bigserial PRIMARY KEY,
    department text NOT NULL,
    tier text NOT NULL REFERENCES tiers (name),
    effective_at timestamptz NOT NULL,
    UNIQUE (department, effective_at)
);

CREATE TABLE IF NOT EXISTS tables (
    id bigserial PRIMARY KEY,
    slug text NOT NULL UNIQUE,
    name text NOT NULL,
    department text NOT NULL,
    tier text NOT NULL,
    locked_period text
);

CREATE TABLE IF NOT EXISTS columns (
    id bigserial PRIMARY KEY,
    table_slug text NOT NULL,
    caption text NOT NULL,
    position integer NOT NULL,
    type text NOT NULL CHECK (type IN ('text', 'integer', 'decimal', 'date', 'choice', 'flag')),
    options jsonb,
    UNIQUE (table_slug, caption),
    UNIQUE (table_slug, position) DEFERRABLE INITIALLY IMMEDIATE
);

CREATE SEQUENCE IF NOT EXISTS row_position_seq;

CREATE TABLE IF NOT EXISTS rows (
    id bigserial PRIMARY KEY,
    table_slug text NOT NULL,
    inserted_position bigint NOT NULL DEFAULT nextval('row_position_seq'),
    version integer NOT NULL DEFAULT 1,
    cell_values jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS rows_by_table ON rows (table_slug, inserted_position);

CREATE TABLE IF NOT EXISTS views (
    id bigserial PRIMARY KEY,
    table_slug text NOT NULL,
    name text NOT NULL,
    owner text NOT NULL,
    visibility text NOT NULL CHECK (visibility IN ('private', 'shared')),
    filters jsonb NOT NULL DEFAULT '[]'::jsonb,
    sorts jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (table_slug, name)
);

CREATE TABLE IF NOT EXISTS log_entries (
    id bigserial PRIMARY KEY,
    table_slug text NOT NULL,
    ordinal integer NOT NULL,
    action text NOT NULL,
    account text NOT NULL,
    recorded_at timestamptz NOT NULL,
    business_day date NOT NULL,
    column_caption text,
    before jsonb,
    after jsonb,
    subject text,
    previous_hash text NOT NULL,
    entry_hash text NOT NULL,
    UNIQUE (table_slug, ordinal)
);

CREATE TABLE IF NOT EXISTS snapshots (
    id bigserial PRIMARY KEY,
    table_slug text NOT NULL,
    department text NOT NULL,
    period text NOT NULL,
    account text NOT NULL,
    published_at timestamptz NOT NULL,
    business_day date NOT NULL,
    sequence integer NOT NULL,
    tier text NOT NULL,
    row_allowance integer NOT NULL,
    content_allowance_kilobytes integer NOT NULL,
    retention text NOT NULL,
    row_count integer NOT NULL,
    content_bytes bigint NOT NULL,
    rows jsonb NOT NULL,
    UNIQUE (table_slug, period),
    UNIQUE (department, sequence)
);

CREATE TABLE IF NOT EXISTS requests (
    id bigserial PRIMARY KEY,
    account text NOT NULL,
    department text NOT NULL,
    role text NOT NULL,
    state text NOT NULL CHECK (state IN ('open', 'approved', 'declined')),
    reason text,
    raised_at timestamptz NOT NULL DEFAULT now(),
    decided_by text,
    decided_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS requests_one_open ON requests (account, department) WHERE state = 'open';

CREATE TABLE IF NOT EXISTS sessions (
    id bigserial PRIMARY KEY,
    value text NOT NULL UNIQUE,
    account text NOT NULL,
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS login_attempts (
    id bigserial PRIMARY KEY,
    email text NOT NULL,
    attempted_at timestamptz NOT NULL DEFAULT now(),
    outcome text NOT NULL CHECK (outcome IN ('succeeded', 'refused'))
);
CREATE INDEX IF NOT EXISTS login_attempts_by_email ON login_attempts (email, attempted_at);

CREATE TABLE IF NOT EXISTS subscribers (
    id bigserial PRIMARY KEY,
    email text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS enquiries (
    id bigserial PRIMARY KEY,
    full_name text NOT NULL,
    work_email text NOT NULL,
    phone text,
    company text NOT NULL,
    role text,
    message text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
    id bigserial PRIMARY KEY,
    account text NOT NULL,
    key text NOT NULL,
    fingerprint text NOT NULL,
    status integer NOT NULL,
    body text NOT NULL,
    created_at timestamptz NOT NULL,
    UNIQUE (account, key)
);
