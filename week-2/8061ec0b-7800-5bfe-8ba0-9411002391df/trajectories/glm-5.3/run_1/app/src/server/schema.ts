// Schema, applied exactly once per database under one advisory lock (DP-59).
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS app_meta (
  key text PRIMARY KEY,
  value text NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS contract_id_seq START 1004;

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL,
  family_id text,
  school_id text
);

CREATE TABLE IF NOT EXISTS families (
  id text PRIMARY KEY,
  parent_name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  address text NOT NULL
);

CREATE TABLE IF NOT EXISTS schools (
  id text PRIMARY KEY,
  name text NOT NULL,
  delivery_weekday text NOT NULL,
  ordinal int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS students (
  id text PRIMARY KEY,
  name text NOT NULL,
  grade int NOT NULL,
  school_id text NOT NULL REFERENCES schools(id),
  family_id text NOT NULL REFERENCES families(id)
);

CREATE TABLE IF NOT EXISTS price_lists (
  id text PRIMARY KEY,
  effective_date text NOT NULL,
  tax_rate_bp int NOT NULL,
  items jsonb NOT NULL,
  tiers jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  withdrawn_at timestamptz
);

CREATE TABLE IF NOT EXISTS instruments (
  id text PRIMARY KEY,
  serial text NOT NULL UNIQUE,
  instrument_type text NOT NULL,
  size text NOT NULL,
  model text NOT NULL,
  status text NOT NULL,
  current_contract_id text
);

CREATE TABLE IF NOT EXISTS contracts (
  id text PRIMARY KEY,
  numeric_id bigint NOT NULL,
  student_id text NOT NULL REFERENCES students(id),
  family_id text NOT NULL REFERENCES families(id),
  school_id text NOT NULL REFERENCES schools(id),
  instrument_id text NOT NULL REFERENCES instruments(id),
  waiver boolean NOT NULL,
  status text NOT NULL,
  price_list_id text REFERENCES price_lists(id),
  delivery_date text NOT NULL,
  hold_expires_at timestamptz,
  signed_at timestamptz,
  activated_at timestamptz,
  closed_at timestamptz,
  billing_anchor_date text,
  agreement_stored boolean NOT NULL DEFAULT false,
  bill_of_sale_stored boolean NOT NULL DEFAULT false,
  subscription_state text,
  predecessor_id text,
  successor_id text,
  created_at timestamptz NOT NULL,
  created_seq bigint NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS contracts_student_idx ON contracts(student_id);
CREATE INDEX IF NOT EXISTS contracts_family_idx ON contracts(family_id);
CREATE INDEX IF NOT EXISTS contracts_status_idx ON contracts(status);

CREATE TABLE IF NOT EXISTS contract_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  contract_id text NOT NULL REFERENCES contracts(id),
  from_status text,
  to_status text NOT NULL,
  at timestamptz NOT NULL,
  actor text NOT NULL,
  actor_name text,
  seq bigint NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS contract_history_contract_idx ON contract_history(contract_id, seq);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id text PRIMARY KEY,
  contract_id text NOT NULL REFERENCES contracts(id),
  kind text NOT NULL,
  amount_cents bigint NOT NULL,
  transfer_id text,
  payment_id text,
  reversed boolean,
  created_at timestamptz NOT NULL,
  seq bigint NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ledger_contract_idx ON ledger_entries(contract_id, seq);

CREATE TABLE IF NOT EXISTS payments (
  id text PRIMARY KEY,
  contract_id text NOT NULL REFERENCES contracts(id),
  amount_cents bigint NOT NULL,
  base_rent_cents bigint NOT NULL,
  waiver_cents bigint NOT NULL,
  tax_cents bigint NOT NULL,
  killbill_payment_id text NOT NULL,
  reversed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS reversals (
  id text PRIMARY KEY,
  payment_id text NOT NULL REFERENCES payments(id),
  contract_id text NOT NULL REFERENCES contracts(id),
  reason text NOT NULL,
  amount_cents bigint NOT NULL,
  base_rent_cents bigint NOT NULL,
  waiver_cents bigint NOT NULL,
  tax_cents bigint NOT NULL,
  killbill_refund_id text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS signing_links (
  id text PRIMARY KEY,
  contract_id text NOT NULL REFERENCES contracts(id),
  token text NOT NULL UNIQUE,
  status text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS signing_links_contract_idx ON signing_links(contract_id);

CREATE TABLE IF NOT EXISTS condition_events (
  id text PRIMARY KEY,
  contract_id text NOT NULL REFERENCES contracts(id),
  kind text NOT NULL,
  notes text,
  recorded_by text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS condition_events_contract_idx ON condition_events(contract_id, created_at DESC);

CREATE TABLE IF NOT EXISTS condition_photos (
  id text PRIMARY KEY,
  event_id text NOT NULL REFERENCES condition_events(id),
  contract_id text NOT NULL REFERENCES contracts(id)
);
CREATE INDEX IF NOT EXISTS condition_photos_event_idx ON condition_photos(event_id);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id text PRIMARY KEY,
  endpoint text NOT NULL,
  contract_id text NOT NULL,
  key text NOT NULL,
  body_hash text NOT NULL,
  status int NOT NULL,
  response_body jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  committed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS idempotency_scope_idx ON idempotency_keys(endpoint, contract_id, key);

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS record_counters (
  scope text PRIMARY KEY,
  next_seq bigint NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS email_outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  message jsonb NOT NULL,
  created_at timestamptz NOT NULL
);
`;

export async function ensureSchema(
  query: (sql: string, params?: unknown[]) => Promise<unknown>,
  lock: (sql: string, params?: unknown[]) => Promise<unknown>,
  unlock: (sql: string, params?: unknown[]) => Promise<unknown>
): Promise<void> {
  // One advisory lock across every instance that shares this database.
  await lock("SELECT pg_advisory_lock(hashtext('bellroll-schema-lock'))");
  try {
    await query(SCHEMA_SQL);
  } finally {
    await unlock("SELECT pg_advisory_unlock(hashtext('bellroll-schema-lock'))");
  }
}

// Sequences for deterministic ordering within a contract's history and ledger.
export async function ensureOrderCounters(
  query: (sql: string, params?: unknown[]) => Promise<unknown>
): Promise<void> {
  await query(`CREATE TABLE IF NOT EXISTS record_counters (
    scope text NOT NULL,
    next_seq bigint NOT NULL DEFAULT 1,
    PRIMARY KEY (scope)
  )`);
}
