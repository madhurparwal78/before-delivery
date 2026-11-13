// Postgres: the system of record. One pool, one transaction helper, the schema applied at every start.
import pg from "pg";
import { config } from "./config.js";
import { ApiError } from "./errors.js";

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20, connectionTimeoutMillis: 5_000 });
pool.on("error", (error) => console.error("postgres pool error:", error.message));

export type Db = pg.Pool | pg.PoolClient;
export type Tx = pg.PoolClient;

export async function withTx<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query(error instanceof ApiError && error.commitFirst ? "COMMIT" : "ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export const ACTIVE_STATES = ["requested", "awaiting_approval", "approved", "queued", "window_blocked", "applying", "health_wait"] as const;

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL
);
CREATE TABLE IF NOT EXISTS memberships (
  user_id uuid NOT NULL REFERENCES users(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  role text NOT NULL CHECK (role IN ('platform_engineer','service_developer','release_manager','oncall_sre')),
  PRIMARY KEY (user_id, project_id)
);
CREATE TABLE IF NOT EXISTS clusters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  name text NOT NULL,
  time_zone text NOT NULL,
  agent_token_hash text NOT NULL UNIQUE,
  position int NOT NULL,
  UNIQUE (project_id, name)
);
CREATE TABLE IF NOT EXISTS stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  name text NOT NULL,
  cluster_id uuid NOT NULL REFERENCES clusters(id),
  upstream_id uuid REFERENCES stages(id),
  requires_approval boolean NOT NULL,
  position int NOT NULL,
  defaults jsonb NOT NULL,
  UNIQUE (project_id, name)
);
CREATE TABLE IF NOT EXISTS bundles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  version text NOT NULL,
  digest text NOT NULL,
  source_commit text NOT NULL,
  object bytea NOT NULL,
  stored_at timestamptz,
  resources jsonb NOT NULL,
  ingested_at timestamptz NOT NULL,
  ingested_by uuid NOT NULL REFERENCES users(id),
  UNIQUE (project_id, version)
);
CREATE TABLE IF NOT EXISTS sync_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id uuid NOT NULL REFERENCES clusters(id),
  label text NOT NULL,
  days text[] NOT NULL,
  start_time text NOT NULL,
  end_time text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS freeze_policy_versions (
  project_id uuid NOT NULL REFERENCES projects(id),
  version int NOT NULL,
  effective_from timestamptz NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL,
  freezes jsonb NOT NULL,
  PRIMARY KEY (project_id, version)
);
CREATE TABLE IF NOT EXISTS promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id),
  stage_id uuid NOT NULL REFERENCES stages(id),
  kind text NOT NULL CHECK (kind IN ('promotion','rollback')),
  state text NOT NULL,
  bundle_id uuid NOT NULL REFERENCES bundles(id),
  overrides jsonb NOT NULL,
  requested_by uuid NOT NULL REFERENCES users(id),
  requested_at timestamptz NOT NULL,
  policy_version int NOT NULL,
  diff jsonb NOT NULL,
  approval_state text,
  request_expires_at timestamptz,
  decided_by uuid REFERENCES users(id),
  decided_at timestamptz,
  approval_expires_at timestamptz,
  approval_comment text,
  approval_token_hash text UNIQUE,
  window_decisions jsonb NOT NULL DEFAULT '[]',
  freeze_break jsonb,
  restores uuid REFERENCES promotions(id),
  entered_applying_at timestamptz,
  healthy_at timestamptz,
  failed_progress double precision,
  rollback_reason text,
  health_timeline jsonb NOT NULL DEFAULT '[]'
);
CREATE UNIQUE INDEX IF NOT EXISTS promotions_one_active_per_stage ON promotions (stage_id)
  WHERE state IN (${ACTIVE_STATES.map((s) => `'${s}'`).join(",")});
CREATE INDEX IF NOT EXISTS promotions_stage_requested ON promotions (stage_id, requested_at DESC);
CREATE TABLE IF NOT EXISTS promotion_history (
  id bigserial PRIMARY KEY,
  promotion_id uuid NOT NULL REFERENCES promotions(id),
  from_state text,
  to_state text NOT NULL,
  at timestamptz NOT NULL,
  actor text NOT NULL
);
CREATE INDEX IF NOT EXISTS promotion_history_promotion ON promotion_history (promotion_id, id);
CREATE OR REPLACE FUNCTION keelson_history_is_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'promotion history is append-only';
END $$;
CREATE OR REPLACE TRIGGER promotion_history_append_only BEFORE UPDATE OR DELETE ON promotion_history
  FOR EACH ROW EXECUTE FUNCTION keelson_history_is_append_only();
CREATE TABLE IF NOT EXISTS health_rows (
  promotion_id uuid NOT NULL REFERENCES promotions(id),
  ref text NOT NULL,
  kind text NOT NULL,
  namespace text NOT NULL,
  name text NOT NULL,
  position int NOT NULL,
  sync text NOT NULL,
  health text NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (promotion_id, ref)
);
CREATE TABLE IF NOT EXISTS evidence_snapshots (
  promotion_id uuid NOT NULL REFERENCES promotions(id),
  number int NOT NULL,
  body bytea NOT NULL,
  created_at timestamptz NOT NULL,
  stored_at timestamptz,
  PRIMARY KEY (promotion_id, number)
);
CREATE TABLE IF NOT EXISTS messages (
  id bigserial PRIMARY KEY,
  promotion_id uuid NOT NULL REFERENCES promotions(id),
  recipient text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL,
  sent_at timestamptz
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS request_keys (
  user_id uuid NOT NULL REFERENCES users(id),
  method text NOT NULL,
  path text NOT NULL,
  key text NOT NULL,
  body text NOT NULL,
  status int NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, method, path, key)
);
`;
