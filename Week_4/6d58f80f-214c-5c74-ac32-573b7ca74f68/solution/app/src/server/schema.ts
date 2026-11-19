// Applied on every start, idempotently (brief: Deployment). Derived figures (folder counts, storage totals) are
// counted from these rows at read time, so they always move in the same transaction as the change.
import { pool } from "./db.js";

const DDL = `
CREATE TABLE IF NOT EXISTS folders (
  id text PRIMARY KEY,
  name text NOT NULL,
  parent_id text REFERENCES folders(id),
  owner_id text,
  owner_name text,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS folders_parent ON folders (parent_id);

CREATE TABLE IF NOT EXISTS files (
  id text PRIMARY KEY,
  name text NOT NULL,
  folder_id text NOT NULL REFERENCES folders(id),
  size bigint NOT NULL,
  content_type text NOT NULL,
  modified_at timestamptz NOT NULL,
  locked boolean NOT NULL DEFAULT false,
  binned_date date,
  retention_days integer
);
CREATE INDEX IF NOT EXISTS files_folder ON files (folder_id);

CREATE TABLE IF NOT EXISTS grants (
  id text PRIMARY KEY,
  item_type text NOT NULL CHECK (item_type IN ('folder', 'file')),
  item_id text NOT NULL,
  person_id text NOT NULL,
  person_name text NOT NULL,
  person_firm text NOT NULL,
  role text NOT NULL CHECK (role IN ('viewer', 'editor')),
  end_date date NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'ended')),
  ended_reason text CHECK (ended_reason IN ('date', 'removed', 'purged')),
  created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS grants_one_active ON grants (item_id, person_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS grants_person ON grants (person_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS handovers (
  id text PRIMARY KEY,
  folder_id text NOT NULL REFERENCES folders(id),
  from_id text NOT NULL,
  from_name text NOT NULL,
  to_id text NOT NULL,
  to_name text NOT NULL,
  offered_date date NOT NULL,
  lapse_date date NOT NULL,
  status text NOT NULL CHECK (status IN ('offered', 'accepted', 'declined', 'lapsed')),
  created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS handovers_one_open ON handovers (folder_id) WHERE status = 'offered';

CREATE TABLE IF NOT EXISTS policies (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('bin_retention_days', 'partner_grant_days')),
  days integer NOT NULL,
  effective_from date NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (kind, effective_from)
);

CREATE TABLE IF NOT EXISTS uploads (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  folder_id text NOT NULL REFERENCES folders(id),
  name text NOT NULL,
  size bigint NOT NULL,
  content_type text NOT NULL,
  state text NOT NULL,
  part_count integer NOT NULL,
  storage_upload_id text NOT NULL,
  last_activity_at timestamptz NOT NULL,
  cleanup_pending boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS uploads_owner ON uploads (owner_id);

CREATE TABLE IF NOT EXISTS upload_parts (
  upload_id text NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  n integer NOT NULL,
  etag text NOT NULL,
  size bigint NOT NULL,
  PRIMARY KEY (upload_id, n)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  person jsonb NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  person_id text NOT NULL,
  scope text NOT NULL,
  key text NOT NULL,
  fingerprint text NOT NULL,
  status integer NOT NULL,
  body jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (person_id, scope, key)
);

CREATE TABLE IF NOT EXISTS ledger (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL,
  actor_id text,
  actor_name text,
  action text NOT NULL,
  file_id text,
  folder_id text,
  detail jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_file ON ledger (file_id, id);
CREATE INDEX IF NOT EXISTS ledger_folder ON ledger (folder_id, id);

CREATE TABLE IF NOT EXISTS outbox (
  id bigserial PRIMARY KEY,
  change jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

const SCHEMA_LOCK = 73_102_614;

export async function applySchema(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [SCHEMA_LOCK]);
    await client.query(DDL);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
