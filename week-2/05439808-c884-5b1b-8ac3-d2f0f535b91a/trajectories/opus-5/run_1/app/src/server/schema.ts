export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS accounts (
  id bigserial PRIMARY KEY,
  email text NOT NULL,
  email_lower text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  time_zone text NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  role text NOT NULL DEFAULT 'islander',
  trophies integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS villages (
  id bigserial PRIMARY KEY,
  account_id bigint NOT NULL UNIQUE REFERENCES accounts(id),
  created_at timestamptz NOT NULL,
  shield_ends_at timestamptz
);

CREATE TABLE IF NOT EXISTS buildings (
  id bigserial PRIMARY KEY,
  village_id bigint NOT NULL REFERENCES villages(id),
  type text NOT NULL,
  x integer NOT NULL,
  y integer NOT NULL,
  rotation integer NOT NULL,
  level integer NOT NULL,
  created_at timestamptz NOT NULL,
  job_to_level integer,
  job_started_at timestamptz,
  job_finishes_at timestamptz,
  accrual_start timestamptz
);
CREATE INDEX IF NOT EXISTS buildings_village_idx ON buildings (village_id);

CREATE TABLE IF NOT EXISTS training_batches (
  id bigserial PRIMARY KEY,
  village_id bigint NOT NULL REFERENCES villages(id),
  unit text NOT NULL,
  count integer NOT NULL,
  queued_at timestamptz NOT NULL,
  starts_at timestamptz NOT NULL,
  finishes_at timestamptz NOT NULL,
  applied boolean NOT NULL DEFAULT false,
  cancelled_at timestamptz
);
CREATE INDEX IF NOT EXISTS training_village_idx ON training_batches (village_id, id);

CREATE SEQUENCE IF NOT EXISTS ledger_pair_seq;

CREATE TABLE IF NOT EXISTS ledger_entries (
  id bigserial PRIMARY KEY,
  pair_id bigint NOT NULL,
  village_id bigint REFERENCES villages(id),
  kind text NOT NULL,
  asset text NOT NULL,
  amount bigint NOT NULL,
  counterparty_village_id bigint REFERENCES villages(id),
  raid_id bigint,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_village_idx ON ledger_entries (village_id, id DESC);
CREATE INDEX IF NOT EXISTS ledger_pair_idx ON ledger_entries (pair_id);

CREATE TABLE IF NOT EXISTS raids (
  id bigserial PRIMARY KEY,
  attacker_village_id bigint NOT NULL REFERENCES villages(id),
  defender_village_id bigint NOT NULL REFERENCES villages(id),
  state text NOT NULL,
  end_reason text,
  locked_at timestamptz NOT NULL,
  finalize_by timestamptz NOT NULL,
  resolved_at timestamptz,
  seed bigint NOT NULL,
  layout jsonb NOT NULL,
  reserved_army jsonb NOT NULL,
  lootable jsonb NOT NULL,
  resolution_lootable jsonb,
  result jsonb,
  tick_hashes jsonb,
  stars integer,
  destruction integer,
  star_bonus integer
);
CREATE INDEX IF NOT EXISTS raids_attacker_idx ON raids (attacker_village_id, id DESC);
CREATE INDEX IF NOT EXISTS raids_defender_idx ON raids (defender_village_id, id DESC);

CREATE TABLE IF NOT EXISTS raid_deploys (
  id bigserial PRIMARY KEY,
  raid_id bigint NOT NULL REFERENCES raids(id),
  seq integer NOT NULL,
  tick integer NOT NULL,
  unit text NOT NULL,
  x integer NOT NULL,
  y integer NOT NULL,
  UNIQUE (raid_id, seq)
);

CREATE TABLE IF NOT EXISTS auth_tokens (
  id bigserial PRIMARY KEY,
  account_id bigint NOT NULL REFERENCES accounts(id),
  kind text NOT NULL,
  token text NOT NULL UNIQUE,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed boolean NOT NULL DEFAULT false,
  superseded boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS auth_tokens_account_idx ON auth_tokens (account_id, kind);

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  account_id bigint REFERENCES accounts(id),
  csrf_token text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  ended_at timestamptz
);
CREATE INDEX IF NOT EXISTS sessions_account_idx ON sessions (account_id);

CREATE TABLE IF NOT EXISTS throttle_hits (
  id bigserial PRIMARY KEY,
  bucket text NOT NULL,
  at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS throttle_bucket_idx ON throttle_hits (bucket, at);

CREATE TABLE IF NOT EXISTS mail_queue (
  id bigserial PRIMARY KEY,
  to_address text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL,
  claimed_at timestamptz,
  sent_at timestamptz,
  attempts integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS mail_queue_pending_idx ON mail_queue (sent_at, id);

CREATE TABLE IF NOT EXISTS idempotency_records (
  id bigserial PRIMARY KEY,
  account_id bigint NOT NULL REFERENCES accounts(id),
  method text NOT NULL,
  path text NOT NULL,
  key text NOT NULL,
  request_body jsonb NOT NULL,
  status integer NOT NULL,
  response_body jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (account_id, method, path, key)
);

CREATE TABLE IF NOT EXISTS reward_claims (
  id bigserial PRIMARY KEY,
  account_id bigint NOT NULL REFERENCES accounts(id),
  kind text NOT NULL,
  claimed_at timestamptz NOT NULL,
  time_zone text NOT NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  step integer,
  league text
);
CREATE INDEX IF NOT EXISTS reward_claims_idx ON reward_claims (account_id, kind, claimed_at DESC);

CREATE TABLE IF NOT EXISTS clans (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  name_lower text NOT NULL UNIQUE,
  motto text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS clan_members (
  id bigserial PRIMARY KEY,
  clan_id bigint NOT NULL REFERENCES clans(id),
  account_id bigint NOT NULL UNIQUE REFERENCES accounts(id),
  role text NOT NULL,
  joined_at timestamptz NOT NULL,
  mate_since timestamptz
);
CREATE INDEX IF NOT EXISTS clan_members_clan_idx ON clan_members (clan_id);

CREATE TABLE IF NOT EXISTS clan_invitations (
  id bigserial PRIMARY KEY,
  clan_id bigint NOT NULL REFERENCES clans(id),
  email text NOT NULL,
  email_lower text NOT NULL,
  invited_by bigint NOT NULL REFERENCES accounts(id),
  created_at timestamptz NOT NULL,
  state text NOT NULL
);
CREATE INDEX IF NOT EXISTS clan_invitations_email_idx ON clan_invitations (email_lower, state);

CREATE TABLE IF NOT EXISTS clan_messages (
  id bigserial PRIMARY KEY,
  clan_id bigint NOT NULL REFERENCES clans(id),
  author_account_id bigint NOT NULL REFERENCES accounts(id),
  body text,
  removed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS clan_messages_clan_idx ON clan_messages (clan_id, id);

CREATE TABLE IF NOT EXISTS unit_requests (
  id bigserial PRIMARY KEY,
  clan_id bigint NOT NULL REFERENCES clans(id),
  requester_account_id bigint NOT NULL REFERENCES accounts(id),
  unit text NOT NULL,
  count integer NOT NULL,
  given integer NOT NULL DEFAULT 0,
  state text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS unit_requests_clan_idx ON unit_requests (clan_id, id DESC);

CREATE TABLE IF NOT EXISTS donations (
  id bigserial PRIMARY KEY,
  request_id bigint NOT NULL REFERENCES unit_requests(id),
  clan_id bigint NOT NULL REFERENCES clans(id),
  donor_account_id bigint NOT NULL REFERENCES accounts(id),
  recipient_account_id bigint NOT NULL REFERENCES accounts(id),
  unit text NOT NULL,
  count integer NOT NULL,
  pair_id bigint NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS donations_request_idx ON donations (request_id);
CREATE INDEX IF NOT EXISTS donations_donor_idx ON donations (donor_account_id, created_at);
CREATE INDEX IF NOT EXISTS donations_recipient_idx ON donations (recipient_account_id, created_at);
`;
