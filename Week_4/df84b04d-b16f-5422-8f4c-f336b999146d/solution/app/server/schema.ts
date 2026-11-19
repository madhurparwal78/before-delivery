export const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  confirmed boolean NOT NULL DEFAULT false,
  hide_completed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pending_codes (
  account_id text PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts int NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS bullets (
  id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES accounts(id),
  parent_id text,
  position int NOT NULL,
  text text NOT NULL DEFAULT '',
  completed boolean NOT NULL DEFAULT false,
  collapsed boolean NOT NULL DEFAULT false,
  mirror_of text,
  revision int NOT NULL DEFAULT 1,
  trashed_at timestamptz,
  purge_at timestamptz
);
CREATE INDEX IF NOT EXISTS bullets_owner ON bullets (owner_id);
CREATE INDEX IF NOT EXISTS bullets_purge ON bullets (purge_at) WHERE purge_at IS NOT NULL;
CREATE TABLE IF NOT EXISTS revisions (
  bullet_id text NOT NULL,
  revision int NOT NULL,
  account_id text NOT NULL,
  PRIMARY KEY (bullet_id, revision)
);
CREATE TABLE IF NOT EXISTS outline_seqs (
  owner_id text PRIMARY KEY REFERENCES accounts(id),
  seq bigint NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS changes (
  owner_id text NOT NULL,
  seq bigint NOT NULL,
  payload jsonb NOT NULL,
  published boolean NOT NULL DEFAULT false,
  PRIMARY KEY (owner_id, seq)
);
CREATE INDEX IF NOT EXISTS changes_unpublished ON changes (owner_id, seq) WHERE NOT published;
CREATE TABLE IF NOT EXISTS shares (
  id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES accounts(id),
  bullet_id text NOT NULL,
  email text NOT NULL,
  token text NOT NULL UNIQUE,
  status text NOT NULL,
  account_id text REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shares_bullet ON shares (bullet_id);
CREATE INDEX IF NOT EXISTS shares_account ON shares (account_id) WHERE status = 'accepted';
CREATE SEQUENCE IF NOT EXISTS step_order;
CREATE TABLE IF NOT EXISTS steps (
  id bigserial PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id),
  outline_owner_id text NOT NULL,
  stack text NOT NULL,
  kind text NOT NULL,
  bullet_id text NOT NULL,
  data jsonb NOT NULL,
  ord bigint NOT NULL DEFAULT nextval('step_order')
);
CREATE INDEX IF NOT EXISTS steps_account ON steps (account_id, stack, ord);
CREATE INDEX IF NOT EXISTS steps_bullet ON steps (bullet_id);
`;
