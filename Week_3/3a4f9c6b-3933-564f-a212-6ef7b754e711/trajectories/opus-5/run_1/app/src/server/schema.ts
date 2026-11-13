import { pool } from './db.js';
import { ACTIVE_STATES } from './domain/transitions.js';

const activeStateList = ACTIVE_STATES.map((state) => `'${state}'`).join(', ');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS people (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships (
  project_id uuid NOT NULL REFERENCES projects(id),
  person_id uuid NOT NULL REFERENCES people(id),
  role text NOT NULL,
  PRIMARY KEY (project_id, person_id)
);

CREATE TABLE IF NOT EXISTS clusters (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id),
  name text NOT NULL,
  time_zone text NOT NULL,
  agent_token text NOT NULL UNIQUE,
  UNIQUE (project_id, name)
);

CREATE TABLE IF NOT EXISTS stages (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id),
  name text NOT NULL,
  cluster_id uuid NOT NULL REFERENCES clusters(id),
  upstream_stage_id uuid REFERENCES stages(id),
  requires_approval boolean NOT NULL,
  defaults jsonb NOT NULL,
  position integer NOT NULL,
  UNIQUE (project_id, name)
);

CREATE TABLE IF NOT EXISTS bundles (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id),
  version text NOT NULL,
  digest text NOT NULL,
  source_commit text NOT NULL,
  manifests jsonb NOT NULL,
  resources jsonb NOT NULL,
  ingested_at timestamptz NOT NULL,
  ingested_by uuid NOT NULL REFERENCES people(id),
  UNIQUE (project_id, version)
);

CREATE TABLE IF NOT EXISTS sync_windows (
  id uuid PRIMARY KEY,
  cluster_id uuid NOT NULL REFERENCES clusters(id),
  label text NOT NULL,
  days text[] NOT NULL,
  start_minutes integer NOT NULL,
  end_minutes integer NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS freeze_policy_versions (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id),
  version integer NOT NULL,
  effective_from timestamptz NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  freezes jsonb NOT NULL,
  UNIQUE (project_id, version)
);

CREATE TABLE IF NOT EXISTS promotions (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id),
  stage_id uuid NOT NULL REFERENCES stages(id),
  bundle_id uuid NOT NULL REFERENCES bundles(id),
  kind text NOT NULL,
  state text NOT NULL,
  overrides jsonb NOT NULL,
  diff jsonb NOT NULL,
  requested_by uuid NOT NULL REFERENCES people(id),
  requested_at timestamptz NOT NULL,
  policy_version integer NOT NULL,
  approval_required boolean NOT NULL,
  approval_state text,
  request_expires_at timestamptz,
  approval_decided_by text,
  approval_decided_at timestamptz,
  approval_expires_at timestamptz,
  approval_comment text,
  restores_promotion_id uuid REFERENCES promotions(id),
  freeze_break jsonb,
  degraded_progress numeric,
  entered_applying_at timestamptz,
  seq bigserial NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS promotions_one_active_per_stage
  ON promotions (stage_id) WHERE state IN (${activeStateList});

CREATE INDEX IF NOT EXISTS promotions_by_stage ON promotions (stage_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS promotions_applied ON promotions (stage_id, entered_applying_at DESC);

CREATE TABLE IF NOT EXISTS promotion_history (
  id bigserial PRIMARY KEY,
  promotion_id uuid NOT NULL REFERENCES promotions(id),
  from_state text,
  to_state text NOT NULL,
  at timestamptz NOT NULL,
  actor text NOT NULL
);

CREATE INDEX IF NOT EXISTS promotion_history_by_promotion ON promotion_history (promotion_id, id);

CREATE TABLE IF NOT EXISTS health_rows (
  promotion_id uuid NOT NULL REFERENCES promotions(id),
  ref text NOT NULL,
  kind text NOT NULL,
  namespace text NOT NULL,
  name text NOT NULL,
  sync text NOT NULL,
  health text NOT NULL,
  updated_at timestamptz NOT NULL,
  position integer NOT NULL,
  PRIMARY KEY (promotion_id, ref)
);

CREATE TABLE IF NOT EXISTS health_timeline (
  id bigserial PRIMARY KEY,
  promotion_id uuid NOT NULL REFERENCES promotions(id),
  at timestamptz NOT NULL,
  phase text NOT NULL,
  in_sync integer NOT NULL,
  total integer NOT NULL
);

CREATE TABLE IF NOT EXISTS window_decisions (
  id bigserial PRIMARY KEY,
  promotion_id uuid NOT NULL REFERENCES promotions(id),
  decision jsonb NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS object_uploads (
  id bigserial PRIMARY KEY,
  object_key text NOT NULL UNIQUE,
  body bytea NOT NULL,
  promotion_id uuid REFERENCES promotions(id),
  snapshot_number integer,
  stored boolean NOT NULL DEFAULT false,
  attempts integer NOT NULL DEFAULT 0,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS object_uploads_pending ON object_uploads (stored, id) WHERE NOT stored;
CREATE INDEX IF NOT EXISTS object_uploads_snapshots ON object_uploads (promotion_id, snapshot_number);

CREATE TABLE IF NOT EXISTS mail_queue (
  id bigserial PRIMARY KEY,
  recipient text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  dedupe_key text NOT NULL UNIQUE,
  promotion_id uuid REFERENCES promotions(id),
  sent boolean NOT NULL DEFAULT false,
  attempts integer NOT NULL DEFAULT 0,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS mail_queue_pending ON mail_queue (sent, id) WHERE NOT sent;

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  person_id uuid NOT NULL REFERENCES people(id),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS request_keys (
  id bigserial PRIMARY KEY,
  person_id uuid NOT NULL REFERENCES people(id),
  method text NOT NULL,
  path text NOT NULL,
  request_key text NOT NULL,
  body_hash text NOT NULL,
  status integer,
  response_body jsonb,
  completed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  UNIQUE (person_id, method, path, request_key)
);

CREATE TABLE IF NOT EXISTS approval_links (
  token_hash text PRIMARY KEY,
  promotion_id uuid NOT NULL UNIQUE REFERENCES promotions(id),
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS service_status (
  only_row boolean PRIMARY KEY DEFAULT true CHECK (only_row),
  storage_up boolean NOT NULL,
  mail_up boolean NOT NULL,
  checked_at timestamptz NOT NULL
);
`;

/** Promotion history is append-only, so the database itself refuses updates and deletes. */
const APPEND_ONLY_HISTORY = `
DROP RULE IF EXISTS promotion_history_no_update ON promotion_history;
DROP RULE IF EXISTS promotion_history_no_delete ON promotion_history;
CREATE RULE promotion_history_no_update AS ON UPDATE TO promotion_history DO INSTEAD NOTHING;
CREATE RULE promotion_history_no_delete AS ON DELETE TO promotion_history DO INSTEAD NOTHING;
`;

export async function applySchema(): Promise<void> {
  await pool.query(SCHEMA);
  await pool.query(APPEND_ONLY_HISTORY);
}
