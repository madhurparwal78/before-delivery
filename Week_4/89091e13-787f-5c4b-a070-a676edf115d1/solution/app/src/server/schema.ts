/** The schema, applied idempotently every time the server starts. */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS clock (
  id int PRIMARY KEY CHECK (id = 1),
  instant timestamptz(3) NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  next_block text NOT NULL DEFAULT 'honest'
);
CREATE TABLE IF NOT EXISTS members (
  seq bigserial,
  workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  role text NOT NULL,
  joined_at timestamptz(3) NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);
CREATE TABLE IF NOT EXISTS invites (
  token text PRIMARY KEY,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL,
  expires_at timestamptz(3) NOT NULL,
  used_at timestamptz(3)
);
CREATE TABLE IF NOT EXISTS namespaces (
  seq bigserial,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  name text NOT NULL,
  hex text NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS transactions (
  seq bigserial UNIQUE,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  kind text NOT NULL,
  sender uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  reason text,
  height int,
  fee_ufern bigint NOT NULL,
  gas int NOT NULL,
  held_ufern bigint NOT NULL DEFAULT 0,
  params jsonb NOT NULL DEFAULT '{}',
  submitted_at timestamptz(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS transactions_pending ON transactions (workspace_id, status, seq);
CREATE TABLE IF NOT EXISTS blobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_id uuid NOT NULL UNIQUE REFERENCES transactions ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  namespace text NOT NULL,
  size int NOT NULL,
  shares int NOT NULL,
  payload bytea NOT NULL,
  object_stored boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS blocks (
  workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  height int NOT NULL,
  produced_at timestamptz(3) NOT NULL,
  k int NOT NULL,
  status text NOT NULL DEFAULT 'sampling',
  blob_count int NOT NULL,
  withheld boolean NOT NULL,
  data_root text NOT NULL,
  row_roots jsonb NOT NULL,
  column_roots jsonb NOT NULL,
  positions jsonb NOT NULL,
  square bytea NOT NULL,
  rejection jsonb,
  fraud_checked boolean NOT NULL DEFAULT false,
  snapshot_stored boolean NOT NULL DEFAULT false,
  PRIMARY KEY (workspace_id, height)
);
CREATE TABLE IF NOT EXISTS fraud_proofs (
  workspace_id uuid NOT NULL,
  height int NOT NULL,
  proof jsonb NOT NULL,
  published_at timestamptz(3) NOT NULL,
  PRIMARY KEY (workspace_id, height),
  FOREIGN KEY (workspace_id, height) REFERENCES blocks ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS light_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  name text NOT NULL,
  number int NOT NULL,
  auto_sample boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS samples (
  node_id uuid NOT NULL REFERENCES light_nodes ON DELETE CASCADE,
  height int NOT NULL,
  index int NOT NULL,
  row int NOT NULL,
  col int NOT NULL,
  served boolean NOT NULL,
  confidence text NOT NULL,
  taken_at timestamptz(3) NOT NULL,
  PRIMARY KEY (node_id, height, index)
);
CREATE TABLE IF NOT EXISTS auto_sampling (
  node_id uuid NOT NULL REFERENCES light_nodes ON DELETE CASCADE,
  height int NOT NULL,
  ticks int NOT NULL DEFAULT 0,
  PRIMARY KEY (node_id, height)
);
CREATE TABLE IF NOT EXISTS validators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  name text NOT NULL,
  self_stake_ufern bigint NOT NULL,
  commission_basis_points int NOT NULL
);
CREATE TABLE IF NOT EXISTS delegations (
  workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  validator_id uuid NOT NULL REFERENCES validators ON DELETE CASCADE,
  amount_ufern bigint NOT NULL,
  pending_rewards_ufern bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, user_id, validator_id)
);
CREATE TABLE IF NOT EXISTS unbondings (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  validator_id uuid NOT NULL REFERENCES validators ON DELETE CASCADE,
  amount_ufern bigint NOT NULL,
  completes_at timestamptz(3) NOT NULL,
  released_at timestamptz(3)
);
CREATE TABLE IF NOT EXISTS redelegations (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  from_validator uuid NOT NULL REFERENCES validators ON DELETE CASCADE,
  to_validator uuid NOT NULL REFERENCES validators ON DELETE CASCADE,
  amount_ufern bigint NOT NULL,
  arrived_at timestamptz(3) NOT NULL,
  movable_at timestamptz(3) NOT NULL
);
CREATE TABLE IF NOT EXISTS proposals (
  workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  number int NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  status text NOT NULL,
  deposit_ufern bigint NOT NULL DEFAULT 0,
  deposit_ends_at timestamptz(3) NOT NULL,
  voting_ends_at timestamptz(3),
  final_tally jsonb,
  reminder_sent boolean NOT NULL DEFAULT false,
  PRIMARY KEY (workspace_id, number)
);
CREATE TABLE IF NOT EXISTS proposal_deposits (
  workspace_id uuid NOT NULL,
  number int NOT NULL,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  amount_ufern bigint NOT NULL,
  FOREIGN KEY (workspace_id, number) REFERENCES proposals ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS votes (
  workspace_id uuid NOT NULL,
  number int NOT NULL,
  voter text NOT NULL,
  option text NOT NULL,
  PRIMARY KEY (workspace_id, number, voter),
  FOREIGN KEY (workspace_id, number) REFERENCES proposals ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS ledger_entries (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces ON DELETE CASCADE,
  pair_id uuid NOT NULL,
  account text NOT NULL,
  counter_account text NOT NULL,
  kind text NOT NULL,
  label text NOT NULL,
  amount_ufern bigint NOT NULL,
  height int NOT NULL,
  at timestamptz(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_account ON ledger_entries (workspace_id, account);
CREATE TABLE IF NOT EXISTS mail_outbox (
  id bigserial PRIMARY KEY,
  recipient text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  sent_at timestamptz(3),
  next_attempt_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  scope text NOT NULL,
  key text NOT NULL,
  fingerprint text NOT NULL,
  body jsonb NOT NULL,
  PRIMARY KEY (scope, key)
);
`;

/** Every table, for the grading reset. */
export const TABLES = [
  "clock", "users", "sessions", "workspaces", "members", "invites", "namespaces", "transactions", "blobs", "blocks",
  "fraud_proofs", "light_nodes", "samples", "auto_sampling", "validators", "delegations", "unbondings", "redelegations",
  "proposals", "proposal_deposits", "votes", "ledger_entries", "mail_outbox", "idempotency_keys",
] as const;
