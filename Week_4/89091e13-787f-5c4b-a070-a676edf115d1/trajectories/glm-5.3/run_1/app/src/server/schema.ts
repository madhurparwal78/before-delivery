// PostgreSQL schema, applied idempotently on every server start.

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  next_block TEXT NOT NULL DEFAULT 'honest',
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','developer','viewer')),
  joined_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (workspace_id, person_id)
);

CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('developer','viewer')),
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS namespaces (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  hex TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  sender_id TEXT NOT NULL REFERENCES people(id),
  status TEXT NOT NULL,
  status_text TEXT NOT NULL,
  height INTEGER,
  fee_ufern BIGINT NOT NULL,
  gas INTEGER NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL,
  included_at TIMESTAMPTZ,
  sequence INTEGER NOT NULL,
  payload JSONB NOT NULL,
  hold_ufern BIGINT NOT NULL DEFAULT 0,
  refusal TEXT,
  idempotency_key TEXT
);
CREATE INDEX IF NOT EXISTS transactions_workspace_idx ON transactions (workspace_id, submitted_at, sequence);
CREATE UNIQUE INDEX IF NOT EXISTS transactions_idem_idx ON transactions (sender_id, workspace_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS blobs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  tx_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  namespace TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  shares INTEGER NOT NULL,
  positions JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS blobs_workspace_idx ON blobs (workspace_id, created_at);

CREATE TABLE IF NOT EXISTS blocks (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  height INTEGER NOT NULL,
  produced_at TIMESTAMPTZ NOT NULL,
  square_width INTEGER NOT NULL,
  status TEXT NOT NULL,
  blob_count INTEGER NOT NULL,
  data_root TEXT NOT NULL,
  layout JSONB NOT NULL,
  row_roots JSONB NOT NULL,
  column_roots JSONB NOT NULL,
  shares_hex JSONB NOT NULL,
  withheld JSONB NOT NULL DEFAULT '[]',
  producer_behaviour TEXT NOT NULL DEFAULT 'honest',
  rejection JSONB,
  PRIMARY KEY (workspace_id, height)
);

CREATE TABLE IF NOT EXISTS block_blobs (
  workspace_id TEXT NOT NULL,
  height INTEGER NOT NULL,
  blob_id TEXT NOT NULL REFERENCES blobs(id) ON DELETE CASCADE,
  PRIMARY KEY (workspace_id, height, blob_id)
);

CREATE TABLE IF NOT EXISTS fraud_proofs (
  workspace_id TEXT NOT NULL,
  height INTEGER NOT NULL,
  axis TEXT NOT NULL,
  index INTEGER NOT NULL,
  body JSONB NOT NULL,
  published_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (workspace_id, height)
);

CREATE TABLE IF NOT EXISTS light_nodes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  number INTEGER NOT NULL,
  auto_sample BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (workspace_id, name)
);

CREATE TABLE IF NOT EXISTS samples (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL REFERENCES light_nodes(id) ON DELETE CASCADE,
  height INTEGER NOT NULL,
  index INTEGER NOT NULL,
  row INTEGER NOT NULL,
  col INTEGER NOT NULL,
  served BOOLEAN NOT NULL,
  taken_at TIMESTAMPTZ NOT NULL,
  UNIQUE (node_id, height, index)
);

CREATE TABLE IF NOT EXISTS validators (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  self_stake_ufern BIGINT NOT NULL,
  commission NUMERIC NOT NULL,
  UNIQUE (workspace_id, name)
);

CREATE TABLE IF NOT EXISTS delegations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  validator_id TEXT NOT NULL REFERENCES validators(id) ON DELETE CASCADE,
  amount_ufern BIGINT NOT NULL,
  pending_rewards_ufern BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (person_id, validator_id)
);

CREATE TABLE IF NOT EXISTS unbondings (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  validator_id TEXT NOT NULL REFERENCES validators(id) ON DELETE CASCADE,
  amount_ufern BIGINT NOT NULL,
  included_at TIMESTAMPTZ NOT NULL,
  completes_at TIMESTAMPTZ NOT NULL,
  released_at TIMESTAMPTZ,
  tx_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS redelegations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  from_validator_id TEXT NOT NULL,
  to_validator_id TEXT NOT NULL,
  amount_ufern BIGINT NOT NULL,
  arrived_at TIMESTAMPTZ NOT NULL,
  movable_at TIMESTAMPTZ NOT NULL,
  tx_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS proposals (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL,
  status_text TEXT NOT NULL,
  deposit_ufern BIGINT NOT NULL,
  min_deposit_ufern BIGINT NOT NULL,
  tx_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  deposit_ends_at TIMESTAMPTZ,
  voting_ends_at TIMESTAMPTZ,
  voting_opened_at TIMESTAMPTZ,
  tally JSONB,
  PRIMARY KEY (workspace_id, number)
);

CREATE TABLE IF NOT EXISTS deposits (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  number INTEGER NOT NULL,
  person_id TEXT NOT NULL,
  amount_ufern BIGINT NOT NULL,
  tx_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  refunded BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS votes (
  workspace_id TEXT NOT NULL,
  number INTEGER NOT NULL,
  person_id TEXT NOT NULL,
  option TEXT NOT NULL CHECK (option IN ('yes','no','no_with_veto','abstain')),
  tx_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (workspace_id, number, person_id)
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  pair_id TEXT NOT NULL,
  account TEXT NOT NULL,
  counter_account TEXT NOT NULL,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  amount_ufern BIGINT NOT NULL,
  height INTEGER,
  at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_workspace_idx ON ledger_entries (workspace_id, at);

CREATE TABLE IF NOT EXISTS mail_outbox (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL,
  kind TEXT NOT NULL,
  body JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS events_workspace_idx ON events (workspace_id, id);

CREATE TABLE IF NOT EXISTS idempotency (
  sender_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status INTEGER NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (sender_id, workspace_id, key)
);
`;
