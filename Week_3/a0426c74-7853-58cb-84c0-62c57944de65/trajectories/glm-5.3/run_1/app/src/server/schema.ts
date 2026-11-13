// Idempotent schema, applied on every serve.
export const SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS users (
    username text PRIMARY KEY,
    password_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token text PRIMARY KEY,
    username text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS folders (
    id text PRIMARY KEY,
    name text NOT NULL,
    parent_id text,
    created_by text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS folder_roles (
    folder_id text NOT NULL,
    username text NOT NULL,
    role text NOT NULL,
    PRIMARY KEY (folder_id, username)
  )`,
  `CREATE TABLE IF NOT EXISTS drawings (
    id text PRIMARY KEY,
    folder_id text NOT NULL,
    name text NOT NULL,
    revision bigint NOT NULL DEFAULT 0,
    next_handle bigint NOT NULL DEFAULT 1,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS drawing_model (
    drawing_id text PRIMARY KEY,
    model jsonb NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS operations (
    id bigserial PRIMARY KEY,
    drawing_id text NOT NULL,
    op_id text NOT NULL,
    group_id text NOT NULL,
    command text NOT NULL,
    author text NOT NULL,
    base_revision bigint NOT NULL,
    revision bigint NOT NULL,
    payload jsonb NOT NULL,
    result jsonb NOT NULL,
    at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS operations_op_id ON operations (drawing_id, op_id)`,
  `CREATE INDEX IF NOT EXISTS operations_drawing_rev ON operations (drawing_id, revision)`,
  `CREATE TABLE IF NOT EXISTS entity_history (
    drawing_id text NOT NULL,
    handle text NOT NULL,
    revision bigint NOT NULL,
    username text NOT NULL,
    command text NOT NULL,
    at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (drawing_id, handle, revision)
  )`,
  `CREATE TABLE IF NOT EXISTS undo_stack (
    id bigserial PRIMARY KEY,
    drawing_id text NOT NULL,
    username text NOT NULL,
    kind text NOT NULL,
    group_id text NOT NULL,
    command text NOT NULL,
    payload jsonb NOT NULL,
    at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS undo_stack_idx ON undo_stack (drawing_id, username, kind, at)`,
  `CREATE TABLE IF NOT EXISTS login_attempts (
    username text NOT NULL,
    at timestamptz NOT NULL DEFAULT now(),
    ok boolean NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS login_attempts_idx ON login_attempts (username, at)`,
  `CREATE TABLE IF NOT EXISTS op_rate (
    username text NOT NULL,
    at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS op_rate_idx ON op_rate (username, at)`,
  `CREATE TABLE IF NOT EXISTS sheets (
    id text PRIMARY KEY,
    drawing_id text NOT NULL,
    name text NOT NULL,
    size text NOT NULL,
    number bigint NOT NULL,
    locked boolean NOT NULL DEFAULT false,
    locked_by text,
    created_by text NOT NULL,
    attributes jsonb NOT NULL DEFAULT '{}'::jsonb
  )`,
  `CREATE TABLE IF NOT EXISTS viewports (
    id text PRIMARY KEY,
    sheet_id text NOT NULL,
    x double precision NOT NULL,
    y double precision NOT NULL,
    width double precision NOT NULL,
    height double precision NOT NULL,
    scale text NOT NULL,
    view_x double precision NOT NULL,
    view_y double precision NOT NULL,
    frozen_layers jsonb NOT NULL DEFAULT '[]'::jsonb
  )`,
  `CREATE TABLE IF NOT EXISTS sheet_versions (
    id text PRIMARY KEY,
    sheet_id text NOT NULL,
    drawing_id text NOT NULL,
    number bigint NOT NULL,
    state text NOT NULL,
    replaced_by bigint,
    keys jsonb,
    snapshot jsonb,
    published_at timestamptz,
    created_by text NOT NULL,
    UNIQUE (sheet_id, number)
  )`,
  `CREATE TABLE IF NOT EXISTS version_stamps (
    version_id text NOT NULL,
    kind text NOT NULL,
    username text NOT NULL,
    at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS review_steps (
    version_id text NOT NULL,
    step text NOT NULL,
    state text NOT NULL,
    due_at timestamptz,
    acted_by text,
    acted_at timestamptz,
    comment text,
    PRIMARY KEY (version_id, step)
  )`,
  `CREATE TABLE IF NOT EXISTS markups (
    id text PRIMARY KEY,
    version_id text NOT NULL,
    kind text NOT NULL,
    x1 double precision NOT NULL,
    y1 double precision NOT NULL,
    x2 double precision NOT NULL,
    y2 double precision NOT NULL,
    text text,
    flag text,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS issues (
    id text PRIMARY KEY,
    version_id text NOT NULL,
    drawing_id text NOT NULL,
    title text NOT NULL,
    x double precision NOT NULL,
    y double precision NOT NULL,
    state text NOT NULL,
    creator text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS rfis (
    id text PRIMARY KEY,
    issue_id text NOT NULL,
    question text NOT NULL,
    answer text,
    asker text NOT NULL,
    addressee text NOT NULL,
    state text NOT NULL,
    ball_in_court text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS view_links (
    id text PRIMARY KEY,
    token text NOT NULL UNIQUE,
    version_id text NOT NULL,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    revoked boolean NOT NULL DEFAULT false
  )`,
  `CREATE TABLE IF NOT EXISTS underlays (
    id text PRIMARY KEY,
    drawing_id text NOT NULL,
    key text NOT NULL,
    bytes bigint NOT NULL,
    sha256 text NOT NULL,
    x1 double precision NOT NULL,
    y1 double precision NOT NULL,
    x2 double precision NOT NULL,
    y2 double precision NOT NULL,
    created_by text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS imports (
    id text PRIMARY KEY,
    drawing_id text NOT NULL,
    key text NOT NULL,
    bytes bigint NOT NULL,
    sha256 text NOT NULL,
    parsed jsonb,
    renames jsonb,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS exports (
    id text PRIMARY KEY,
    drawing_id text NOT NULL,
    format text NOT NULL,
    state text NOT NULL,
    progress bigint NOT NULL DEFAULT 0,
    step_at timestamptz,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS grading_clock (
    id integer PRIMARY KEY DEFAULT 1,
    offset_ms bigint NOT NULL DEFAULT 0
  )`,
  `INSERT INTO grading_clock (id, offset_ms) VALUES (1, 0) ON CONFLICT (id) DO NOTHING`,
  `CREATE TABLE IF NOT EXISTS drawing_views (
    drawing_id text NOT NULL,
    username text NOT NULL,
    zoom double precision NOT NULL DEFAULT 1,
    pan_x double precision NOT NULL DEFAULT 0,
    pan_y double precision NOT NULL DEFAULT 0,
    PRIMARY KEY (drawing_id, username)
  )`,
];
