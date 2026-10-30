export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS organizations (
  id text PRIMARY KEY,
  name text NOT NULL,
  app_id text NOT NULL UNIQUE,
  webhook_secret text NOT NULL,
  created_at timestamptz NOT NULL,
  audit_seq bigint NOT NULL DEFAULT 0,
  webhook_seq bigint NOT NULL DEFAULT 0,
  seeded boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS members (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  role text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  member_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS api_keys (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  role text NOT NULL,
  prefix text NOT NULL,
  secret_hash text NOT NULL UNIQUE,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE TABLE IF NOT EXISTS policies (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  version text NOT NULL,
  name text NOT NULL,
  chain_type text NOT NULL,
  rules jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS policy_revisions (
  policy_id text NOT NULL REFERENCES policies(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  name text NOT NULL,
  rules jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (policy_id, revision)
);
CREATE TABLE IF NOT EXISTS aggregations (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  metric text NOT NULL,
  window_seconds integer NOT NULL,
  asset text NOT NULL,
  group_by text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS key_quorums (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  member_ids jsonb NOT NULL,
  authorization_threshold integer NOT NULL,
  expiry_seconds integer NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS wallets (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  chain text NOT NULL,
  asset text NOT NULL,
  address text NOT NULL,
  balance_raw numeric NOT NULL DEFAULT 0,
  policy_id text REFERENCES policies(id),
  quorum_id text REFERENCES key_quorums(id),
  approval_floor_raw numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS intents (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  wallet_id text NOT NULL REFERENCES wallets(id),
  kind text NOT NULL,
  destination_address text,
  raw_amount numeric NOT NULL,
  memo text NOT NULL DEFAULT '',
  status text NOT NULL,
  created_by text NOT NULL,
  required_approvals integer NOT NULL DEFAULT 0,
  quorum_member_ids jsonb,
  policy_decision jsonb,
  created_at timestamptz NOT NULL,
  expires_at timestamptz,
  decided_at timestamptz,
  executed_at timestamptz,
  tx_hash text,
  rejection_reason text
);
CREATE INDEX IF NOT EXISTS intents_org_created ON intents (organization_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS intents_wallet ON intents (wallet_id, created_at DESC, id DESC);
CREATE TABLE IF NOT EXISTS intent_items (
  intent_id text NOT NULL REFERENCES intents(id) ON DELETE CASCADE,
  position integer NOT NULL,
  destination_address text NOT NULL,
  raw_amount numeric NOT NULL,
  memo text NOT NULL DEFAULT '',
  PRIMARY KEY (intent_id, position)
);
CREATE TABLE IF NOT EXISTS approvals (
  intent_id text NOT NULL REFERENCES intents(id) ON DELETE CASCADE,
  member_id text NOT NULL,
  decision text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (intent_id, member_id)
);
CREATE TABLE IF NOT EXISTS deposits (
  id text PRIMARY KEY,
  wallet_id text NOT NULL REFERENCES wallets(id),
  raw_amount numeric NOT NULL,
  reference text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (wallet_id, reference)
);
CREATE TABLE IF NOT EXISTS ledger_entries (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id),
  movement_id text NOT NULL,
  kind text NOT NULL,
  account text NOT NULL,
  asset text NOT NULL,
  raw_amount numeric NOT NULL,
  intent_id text,
  deposit_id text,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_movement ON ledger_entries (movement_id);
CREATE INDEX IF NOT EXISTS ledger_account ON ledger_entries (account);
CREATE TABLE IF NOT EXISTS idempotency_records (
  organization_id text NOT NULL,
  key text NOT NULL,
  method text NOT NULL,
  path text NOT NULL,
  body_sha256 text NOT NULL,
  status_code integer,
  response text,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, key)
);
CREATE TABLE IF NOT EXISTS audit_events (
  organization_id text NOT NULL REFERENCES organizations(id),
  seq bigint NOT NULL,
  type text NOT NULL,
  actor text NOT NULL,
  subject_id text NOT NULL,
  at timestamptz NOT NULL,
  data jsonb NOT NULL,
  prev_hash text NOT NULL,
  hash text NOT NULL,
  PRIMARY KEY (organization_id, seq)
);
CREATE TABLE IF NOT EXISTS webhook_events (
  id text NOT NULL UNIQUE,
  organization_id text NOT NULL REFERENCES organizations(id),
  seq bigint NOT NULL,
  type text NOT NULL,
  created_at timestamptz NOT NULL,
  timestamp bigint NOT NULL,
  body text NOT NULL,
  signature text NOT NULL,
  PRIMARY KEY (organization_id, seq)
);
CREATE TABLE IF NOT EXISTS contact_requests (
  id text PRIMARY KEY,
  full_name text NOT NULL,
  work_email text NOT NULL,
  company text NOT NULL,
  monthly_volume text NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL
);
`;
