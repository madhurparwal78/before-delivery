CREATE TABLE IF NOT EXISTS clock (
  id int PRIMARY KEY,
  now timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS people (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_salt text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS workspaces (
  id text PRIMARY KEY,
  name text NOT NULL,
  next_block text NOT NULL DEFAULT 'honest',
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  person_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  role text NOT NULL,
  joined_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, person_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  person_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS invites (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL,
  token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE TABLE IF NOT EXISTS namespaces (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  hex text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS validators (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  commission_numerator bigint NOT NULL,
  commission_denominator bigint NOT NULL,
  position int NOT NULL
);

CREATE TABLE IF NOT EXISTS delegations (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  validator_id text NOT NULL REFERENCES validators(id) ON DELETE CASCADE,
  person_id text REFERENCES people(id) ON DELETE CASCADE,
  amount_ufern bigint NOT NULL,
  pending_rewards_ufern bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS unbondings (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  validator_id text NOT NULL REFERENCES validators(id) ON DELETE CASCADE,
  person_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  amount_ufern bigint NOT NULL,
  started_at timestamptz NOT NULL,
  completes_at timestamptz NOT NULL,
  released_at timestamptz
);

CREATE TABLE IF NOT EXISTS redelegations (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  person_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  from_validator_id text NOT NULL REFERENCES validators(id) ON DELETE CASCADE,
  to_validator_id text NOT NULL REFERENCES validators(id) ON DELETE CASCADE,
  amount_ufern bigint NOT NULL,
  arrived_at timestamptz NOT NULL,
  movable_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind text NOT NULL,
  sender_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  status text NOT NULL,
  height int,
  fee_ufern bigint NOT NULL,
  gas int NOT NULL,
  held_ufern bigint NOT NULL DEFAULT 0,
  payload jsonb NOT NULL,
  rejection_reason text,
  submitted_at timestamptz NOT NULL,
  sequence bigserial NOT NULL
);

CREATE TABLE IF NOT EXISTS blobs (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  tx_id text NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  namespace_hex text NOT NULL,
  size int NOT NULL,
  shares int NOT NULL,
  payload bytea NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS blocks (
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  height int NOT NULL,
  produced_at timestamptz NOT NULL,
  status text NOT NULL,
  square_width int NOT NULL,
  data_root text NOT NULL,
  row_roots jsonb NOT NULL,
  column_roots jsonb NOT NULL,
  behaviour text NOT NULL,
  blob_count int NOT NULL,
  rejection jsonb,
  fraud_checked_at timestamptz,
  snapshot_stored boolean NOT NULL DEFAULT false,
  PRIMARY KEY (workspace_id, height)
);

CREATE TABLE IF NOT EXISTS block_shares (
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  height int NOT NULL,
  row int NOT NULL,
  col int NOT NULL,
  quadrant text NOT NULL,
  namespace_hex text NOT NULL,
  kind text NOT NULL,
  blob_id text,
  share bytea NOT NULL,
  PRIMARY KEY (workspace_id, height, row, col)
);

CREATE TABLE IF NOT EXISTS light_nodes (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  number int NOT NULL,
  auto_sample boolean NOT NULL,
  auto_sample_since timestamptz
);

CREATE TABLE IF NOT EXISTS samples (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  light_node_id text NOT NULL REFERENCES light_nodes(id) ON DELETE CASCADE,
  height int NOT NULL,
  index int NOT NULL,
  row int NOT NULL,
  col int NOT NULL,
  served boolean NOT NULL,
  at timestamptz NOT NULL,
  UNIQUE (light_node_id, height, index)
);

CREATE TABLE IF NOT EXISTS fraud_proofs (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  height int NOT NULL,
  axis text NOT NULL,
  index int NOT NULL,
  shares jsonb NOT NULL,
  committed_root jsonb NOT NULL,
  recomputed_root jsonb NOT NULL,
  published_at timestamptz NOT NULL,
  UNIQUE (workspace_id, height)
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  pair_id text NOT NULL,
  account text NOT NULL,
  counter_account text NOT NULL,
  kind text NOT NULL,
  label text NOT NULL,
  amount_ufern bigint NOT NULL,
  height int,
  at timestamptz NOT NULL,
  sequence bigserial NOT NULL
);

CREATE INDEX IF NOT EXISTS ledger_entries_account_idx ON ledger_entries (workspace_id, account);

CREATE TABLE IF NOT EXISTS proposals (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  number int NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  status text NOT NULL,
  deposit_ufern bigint NOT NULL,
  deposit_ends_at timestamptz NOT NULL,
  voting_starts_at timestamptz,
  voting_ends_at timestamptz,
  final_tally jsonb,
  reminded_at timestamptz,
  created_at timestamptz NOT NULL,
  UNIQUE (workspace_id, number)
);

CREATE TABLE IF NOT EXISTS deposits (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  proposal_id text NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  person_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  amount_ufern bigint NOT NULL,
  at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS votes (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  proposal_id text NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  person_id text REFERENCES people(id) ON DELETE CASCADE,
  validator_id text REFERENCES validators(id) ON DELETE CASCADE,
  option text NOT NULL,
  at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS votes_person_idx ON votes (proposal_id, person_id)
  WHERE person_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS votes_validator_idx ON votes (proposal_id, validator_id)
  WHERE validator_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS idempotency_keys (
  person_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key text NOT NULL,
  request_fingerprint text NOT NULL,
  response_status int NOT NULL,
  response_body text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (person_id, workspace_id, key)
);

CREATE TABLE IF NOT EXISTS outbox (
  id text PRIMARY KEY,
  workspace_id text REFERENCES workspaces(id) ON DELETE CASCADE,
  recipient text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL,
  sent_at timestamptz,
  attempts int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pending_objects (
  key text PRIMARY KEY,
  workspace_id text REFERENCES workspaces(id) ON DELETE CASCADE,
  body bytea NOT NULL,
  created_at timestamptz NOT NULL
);
