// PostgreSQL: the pool, transactions and the schema, applied idempotently every time the server starts.
import pg from "pg";
import { config } from "./config.js";

pg.types.setTypeParser(pg.types.builtins.INT8, (value: string) => BigInt(value));
pg.types.setTypeParser(pg.types.builtins.DATE, (value: string) => value);

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });

export type Db = pg.Pool | pg.PoolClient;

export async function rows<T>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query(sql, params)).rows as T[];
}

export async function one<T>(db: Db, sql: string, params: unknown[] = []): Promise<T | null> {
  return (await db.query(sql, params)).rows[0] as T | undefined ?? null;
}

export async function tx<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** A transaction-scoped lock on a name, so concurrent requests on one record run one at a time. */
export async function lockName(client: pg.PoolClient, name: string): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [name]);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS copy_meta (
  id int PRIMARY KEY,
  started_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS jurisdictions (
  code text PRIMARY KEY,
  name text NOT NULL,
  region text NOT NULL,
  currency text NOT NULL,
  threshold_cents bigint,
  in_force_since date,
  announced_threshold_cents bigint,
  announced_on date,
  position int NOT NULL
);
CREATE TABLE IF NOT EXISTS workspaces (
  slug text PRIMARY KEY,
  name text NOT NULL,
  legal_name text NOT NULL,
  lei text NOT NULL,
  jurisdiction_code text NOT NULL REFERENCES jurisdictions(code),
  time_zone text NOT NULL,
  city text NOT NULL,
  currency text NOT NULL,
  confirmation_limit_cents bigint NOT NULL,
  case_prefix text NOT NULL,
  sending_address text NOT NULL,
  next_case_number int NOT NULL,
  first_business_date date NOT NULL
);
CREATE TABLE IF NOT EXISTS listings (
  slug text PRIMARY KEY,
  name text NOT NULL,
  jurisdiction_code text NOT NULL REFERENCES jurisdictions(code),
  on_network boolean NOT NULL,
  listed boolean NOT NULL,
  workspace_slug text REFERENCES workspaces(slug),
  position int NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
  id uuid PRIMARY KEY,
  workspace_slug text NOT NULL REFERENCES workspaces(slug),
  name text NOT NULL,
  email text NOT NULL,
  role text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL,
  removed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS members_email_live ON members (lower(email)) WHERE removed_at IS NULL;
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  member_id uuid NOT NULL REFERENCES members(id),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS customers (
  id text PRIMARY KEY,
  workspace_slug text NOT NULL REFERENCES workspaces(slug),
  name text NOT NULL,
  identity_number text NOT NULL,
  date_of_birth date NOT NULL,
  deposit_address text NOT NULL,
  position int NOT NULL
);
CREATE TABLE IF NOT EXISTS rates (
  workspace_slug text NOT NULL REFERENCES workspaces(slug),
  asset text NOT NULL,
  currency text NOT NULL,
  rate_cents bigint NOT NULL,
  in_force_since date NOT NULL,
  position int NOT NULL,
  PRIMARY KEY (workspace_slug, asset, in_force_since)
);
CREATE TABLE IF NOT EXISTS counterparties (
  id uuid PRIMARY KEY,
  workspace_slug text NOT NULL REFERENCES workspaces(slug),
  legal_name text NOT NULL,
  normalised_name text NOT NULL,
  lei text NOT NULL,
  jurisdiction_code text NOT NULL REFERENCES jurisdictions(code),
  licence_number text NOT NULL,
  due_diligence text NOT NULL,
  network text NOT NULL,
  contact_email text,
  notes text NOT NULL,
  signing_value text,
  name_since date NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (workspace_slug, lei),
  UNIQUE (workspace_slug, normalised_name)
);
CREATE TABLE IF NOT EXISTS counterparty_previous_names (
  id bigserial PRIMARY KEY,
  counterparty_id uuid NOT NULL REFERENCES counterparties(id),
  name text NOT NULL,
  from_date date NOT NULL,
  until_date date NOT NULL
);
CREATE TABLE IF NOT EXISTS address_registry (
  workspace_slug text NOT NULL REFERENCES workspaces(slug),
  address text NOT NULL,
  counterparty_id uuid NOT NULL REFERENCES counterparties(id),
  PRIMARY KEY (workspace_slug, address)
);
CREATE TABLE IF NOT EXISTS threshold_changes (
  id uuid PRIMARY KEY,
  workspace_slug text NOT NULL REFERENCES workspaces(slug),
  jurisdiction_code text NOT NULL REFERENCES jurisdictions(code),
  threshold_cents bigint NOT NULL,
  takes_effect_on date NOT NULL,
  takes_effect_at timestamptz NOT NULL,
  announced_by text,
  announced_at timestamptz NOT NULL,
  UNIQUE (workspace_slug, jurisdiction_code, takes_effect_on)
);
CREATE TABLE IF NOT EXISTS partner_keys (
  id uuid PRIMARY KEY,
  workspace_slug text NOT NULL REFERENCES workspaces(slug),
  label text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  starts_with text NOT NULL,
  created_at timestamptz NOT NULL,
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE TABLE IF NOT EXISTS cases (
  id uuid PRIMARY KEY,
  workspace_slug text NOT NULL REFERENCES workspaces(slug),
  number int NOT NULL,
  reference text NOT NULL,
  created_at timestamptz NOT NULL,
  created_by_kind text NOT NULL,
  created_by_name text NOT NULL,
  asset text NOT NULL,
  amount_atomic numeric(80, 0) NOT NULL,
  destination_address text NOT NULL,
  sending_address text NOT NULL,
  wallet text NOT NULL,
  counterparty_id uuid REFERENCES counterparties(id),
  customer_id text NOT NULL REFERENCES customers(id),
  originator_name text,
  originator_identity_number text,
  originator_date_of_birth date,
  beneficiary_name text,
  fiat_value_cents bigint NOT NULL,
  currency text NOT NULL,
  decided_under jsonb NOT NULL,
  path text NOT NULL,
  route text,
  status text NOT NULL,
  ownership_required boolean NOT NULL,
  ownership_confirmed_on date,
  ownership_recorded_at timestamptz,
  ownership_recorded_by text,
  claim_member_id uuid,
  claim_member_name text,
  claimed_at timestamptz,
  claim_ends_at timestamptz,
  decision text,
  decision_reason text,
  decided_by text,
  decided_at timestamptz,
  data_sent_channel text,
  data_sent_at timestamptz,
  name_as_sent text,
  answer_due_at timestamptz,
  answer_decision text,
  answer_at timestamptz,
  answer_late boolean,
  answer_via text,
  release_reason_text text,
  release_reason_by text,
  release_reason_at timestamptz,
  return_reason text,
  outcome text,
  closed_at timestamptz,
  erasure_due_at timestamptz,
  erased_at timestamptz,
  archived_at timestamptz,
  UNIQUE (workspace_slug, number)
);
CREATE INDEX IF NOT EXISTS cases_due ON cases (status, answer_due_at);
CREATE INDEX IF NOT EXISTS cases_erasure ON cases (erasure_due_at) WHERE erased_at IS NULL;
CREATE TABLE IF NOT EXISTS request_pages (
  id uuid PRIMARY KEY,
  workspace_slug text NOT NULL REFERENCES workspaces(slug),
  case_id uuid NOT NULL REFERENCES cases(id),
  token_hash text NOT NULL UNIQUE,
  contact_email text NOT NULL,
  sent_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  ended_at timestamptz,
  answered_at timestamptz,
  answer_note text
);
CREATE TABLE IF NOT EXISTS stored_objects (
  id uuid PRIMARY KEY,
  workspace_slug text NOT NULL REFERENCES workspaces(slug),
  kind text NOT NULL,
  object_key text NOT NULL,
  case_id uuid REFERENCES cases(id),
  sha256 text NOT NULL,
  size_bytes int NOT NULL,
  content_type text NOT NULL,
  stored_at timestamptz NOT NULL,
  deleted_at timestamptz
);
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY REFERENCES stored_objects(id),
  workspace_slug text NOT NULL REFERENCES workspaces(slug),
  counterparty_id uuid NOT NULL REFERENCES counterparties(id),
  message_id text NOT NULL,
  type text NOT NULL,
  received_at timestamptz NOT NULL,
  working jsonb NOT NULL,
  outcome text NOT NULL,
  case_id uuid REFERENCES cases(id),
  customer_id text REFERENCES customers(id),
  first_status int NOT NULL,
  first_body text NOT NULL,
  UNIQUE (workspace_slug, counterparty_id, message_id)
);
CREATE TABLE IF NOT EXISTS metered_messages (
  id bigserial PRIMARY KEY,
  workspace_slug text NOT NULL REFERENCES workspaces(slug),
  at timestamptz NOT NULL,
  direction text NOT NULL
);
CREATE INDEX IF NOT EXISTS metered_messages_at ON metered_messages (workspace_slug, at);
CREATE TABLE IF NOT EXISTS closed_months (
  workspace_slug text NOT NULL REFERENCES workspaces(slug),
  month text NOT NULL,
  invoice_id text NOT NULL,
  closed_at timestamptz NOT NULL,
  message_count int NOT NULL,
  total_cents bigint NOT NULL,
  PRIMARY KEY (workspace_slug, month)
);
CREATE TABLE IF NOT EXISTS fee_lines (
  workspace_slug text NOT NULL,
  month text NOT NULL,
  tier int NOT NULL,
  label text NOT NULL,
  count int NOT NULL,
  unit_price text NOT NULL,
  amount_cents bigint NOT NULL,
  PRIMARY KEY (workspace_slug, month, tier),
  FOREIGN KEY (workspace_slug, month) REFERENCES closed_months(workspace_slug, month)
);
CREATE TABLE IF NOT EXISTS partner_requests (
  partner_key_id uuid NOT NULL REFERENCES partner_keys(id),
  request_key text NOT NULL,
  body_sha256 text NOT NULL,
  status int NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (partner_key_id, request_key)
);
CREATE TABLE IF NOT EXISTS rate_events (
  id bigserial PRIMARY KEY,
  limiter text NOT NULL,
  at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_events_limiter ON rate_events (limiter, at);
`;

export async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended('lanternline-schema', 0))");
    await client.query(SCHEMA);
    await client.query("SELECT pg_advisory_unlock(hashtextextended('lanternline-schema', 0))");
  } finally {
    client.release();
  }
}
