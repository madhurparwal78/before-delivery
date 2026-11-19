import { Pool, PoolClient, type QueryResultRow } from 'pg';
import { ApiError } from './errors';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 20 });

export async function query<T extends QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  try {
    const res = await pool.query(sql, params as unknown[]);
    return res.rows as T[];
  } catch (e) {
    throw toError(e);
  }
}

export async function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  const tx: Tx = client;
  try {
    await client.query('BEGIN');
    const out = await fn(tx);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* connection gone */
    }
    throw e;
  } finally {
    client.release();
  }
}

export interface Tx extends PoolClient {}
export type { PoolClient, QueryResultRow };

export async function txQuery<T extends QueryResultRow>(
  tx: Tx,
  sql: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  try {
    const res = await tx.query(sql, params as unknown[]);
    return res.rows as T[];
  } catch (e) {
    throw toError(e);
  }
}

function toError(e: unknown): Error {
  if (e instanceof ApiError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  return new Error(`database: ${msg}`);
}

export async function endPool(): Promise<void> {
  await pool.end();
}

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS app_meta (
  key text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE IF NOT EXISTS organisations (
  id text PRIMARY KEY,
  key text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL,
  territory text NOT NULL,
  engagement_starts_on date,
  engagement_ends_on date,
  engagement_territories text[] NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS principals (
  id text PRIMARY KEY,
  key text NOT NULL,
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  role text NOT NULL,
  password_hash text NOT NULL,
  organisation_id text,
  invited_by text,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS groups (
  id text PRIMARY KEY,
  key text NOT NULL,
  name text NOT NULL
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id text NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  principal_id text NOT NULL REFERENCES principals(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, principal_id)
);

CREATE TABLE IF NOT EXISTS licences (
  id text PRIMARY KEY,
  key text NOT NULL,
  name text NOT NULL,
  permitted_applications text[] NOT NULL,
  prohibited_applications text[] NOT NULL,
  audiences text[] NOT NULL,
  territories text[] NOT NULL,
  excluded_territories text[] NOT NULL,
  default_duration_days int NOT NULL,
  modification_permitted boolean NOT NULL,
  attribution_required boolean NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
  id text PRIMARY KEY,
  key text NOT NULL,
  name text NOT NULL,
  class text NOT NULL,
  state text NOT NULL,
  licence_id text NOT NULL REFERENCES licences(id),
  successor_id text,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS variants (
  id text PRIMARY KEY,
  asset_id text NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  key text NOT NULL,
  label text NOT NULL,
  position int NOT NULL
);

CREATE TABLE IF NOT EXISTS derivatives (
  id text PRIMARY KEY,
  asset_id text NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  variant_id text REFERENCES variants(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  format text NOT NULL,
  width int NOT NULL,
  height int NOT NULL,
  byte_size bigint NOT NULL,
  position int NOT NULL
);

CREATE TABLE IF NOT EXISTS requests (
  id text PRIMARY KEY,
  idempotency_key text,
  requester_id text NOT NULL REFERENCES principals(id),
  asset_id text NOT NULL REFERENCES assets(id),
  variant_id text REFERENCES variants(id),
  application_class text NOT NULL,
  territories text[] NOT NULL,
  campaign_starts_on date NOT NULL,
  campaign_ends_on date NOT NULL,
  cited_rules jsonb NOT NULL,
  note text NOT NULL,
  state text NOT NULL,
  escalation text,
  holder_id text NOT NULL,
  submitted_at timestamptz,
  deadline timestamptz,
  deadline_submitted_at timestamptz,
  warning_sent_at timestamptz,
  breach_sent_at timestamptz,
  expiry_done_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS request_idempotency (
  principal_id text NOT NULL,
  idempotency_key text NOT NULL,
  request_id text NOT NULL,
  body_hash text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (principal_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS request_stages (
  request_id text NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  n int NOT NULL,
  kind text NOT NULL,
  assignee_id text REFERENCES principals(id),
  decision text,
  decided_at timestamptz,
  comment text,
  assigned_at timestamptz,
  PRIMARY KEY (request_id, n)
);

CREATE TABLE IF NOT EXISTS conditions (
  id text PRIMARY KEY,
  request_id text NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  kind text NOT NULL,
  value text,
  text text NOT NULL,
  added_by text NOT NULL REFERENCES principals(id),
  position int NOT NULL
);

CREATE TABLE IF NOT EXISTS grants (
  id text PRIMARY KEY,
  holder_type text NOT NULL,
  holder_principal_id text REFERENCES principals(id),
  holder_group_id text REFERENCES groups(id),
  asset_id text NOT NULL REFERENCES assets(id),
  variant_id text REFERENCES variants(id),
  request_id text REFERENCES requests(id),
  status text NOT NULL,
  not_before date,
  not_after date NOT NULL,
  cap text,
  revoked_reason text,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS proofs (
  id text PRIMARY KEY,
  grant_id text NOT NULL REFERENCES grants(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  status text NOT NULL,
  reason text,
  uploaded_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS chapters (
  slug text PRIMARY KEY,
  title text NOT NULL,
  position int NOT NULL
);

CREATE TABLE IF NOT EXISTS chapter_versions (
  id text PRIMARY KEY,
  chapter_slug text NOT NULL REFERENCES chapters(slug) ON DELETE CASCADE,
  number int NOT NULL,
  state text NOT NULL,
  author_id text REFERENCES principals(id),
  revision int NOT NULL DEFAULT 1,
  intro text NOT NULL,
  statements jsonb NOT NULL,
  asset_ids text[] NOT NULL DEFAULT '{}',
  withdrawn jsonb NOT NULL DEFAULT '[]',
  published_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (chapter_slug, number)
);

CREATE TABLE IF NOT EXISTS rule_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  identifier text NOT NULL,
  chapter_slug text NOT NULL,
  version_number int NOT NULL,
  event text NOT NULL,
  replaced_by text,
  occurred_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS rule_events_identifier_idx ON rule_events (identifier, id);

CREATE TABLE IF NOT EXISTS invitations (
  id text PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  email text NOT NULL,
  display_name text NOT NULL,
  role text NOT NULL,
  organisation_id text,
  used_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  principal_id text NOT NULL REFERENCES principals(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS download_links (
  token_hash text PRIMARY KEY,
  derivative_id text NOT NULL REFERENCES derivatives(id) ON DELETE CASCADE,
  principal_id text NOT NULL REFERENCES principals(id),
  grant_id text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_records (
  sequence bigint PRIMARY KEY,
  occurred_at timestamptz NOT NULL,
  actor_id text NOT NULL,
  actor_role text NOT NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text NOT NULL,
  request_id text,
  before jsonb,
  after jsonb,
  outcome text NOT NULL,
  previous_hash text NOT NULL,
  record_hash text NOT NULL
);

CREATE TABLE IF NOT EXISTS mail_outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL,
  sent_at timestamptz,
  attempts int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS timers (
  request_id text NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  kind text NOT NULL,
  due_at timestamptz NOT NULL,
  done_at timestamptz,
  PRIMARY KEY (request_id, kind)
);

CREATE TABLE IF NOT EXISTS live_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_sequence (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  last_sequence bigint NOT NULL DEFAULT 0
);
INSERT INTO audit_sequence (singleton, last_sequence) VALUES (true, 0) ON CONFLICT DO NOTHING;
`;

export async function applySchema(): Promise<void> {
  await pool.query(SCHEMA);
}
