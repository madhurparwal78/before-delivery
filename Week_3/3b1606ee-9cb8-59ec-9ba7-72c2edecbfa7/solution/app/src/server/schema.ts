/** Applied on every start; every statement is idempotent. */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY,
  username text NOT NULL UNIQUE,
  key_id text NOT NULL,
  public_key bytea NOT NULL,
  recovery_salt bytea NOT NULL,
  recovery_hash bytea NOT NULL,
  read_receipts boolean NOT NULL DEFAULT true,
  preview text NOT NULL DEFAULT 'name_and_letter',
  profile_iv bytea,
  profile_ciphertext bytea,
  profile_photo_blob_id uuid,
  username_changed_at timestamptz,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS account_keys (
  n bigserial PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts (id),
  key_id text NOT NULL,
  public_key bytea NOT NULL,
  backup_iv bytea NOT NULL,
  backup_ciphertext bytea NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (account_id, key_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash bytea PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts (id),
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_account ON sessions (account_id);

CREATE TABLE IF NOT EXISTS username_holds (
  username text PRIMARY KEY,
  held_until timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS recovery_failures (
  n bigserial PRIMARY KEY,
  username text NOT NULL,
  failed_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS recovery_failures_username ON recovery_failures (username, failed_at);

CREATE TABLE IF NOT EXISTS blobs (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES accounts (id),
  kind text NOT NULL,
  size bigint NOT NULL,
  state text NOT NULL,
  created_at timestamptz NOT NULL,
  discarded_at timestamptz,
  object_removed boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY,
  starter_id uuid NOT NULL REFERENCES accounts (id),
  member_low uuid NOT NULL REFERENCES accounts (id),
  member_high uuid NOT NULL REFERENCES accounts (id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (member_low, member_high)
);

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id uuid NOT NULL REFERENCES conversations (id),
  account_id uuid NOT NULL REFERENCES accounts (id),
  status text NOT NULL,
  visible_from_seq bigint NOT NULL DEFAULT 0,
  read_through_seq bigint NOT NULL DEFAULT 0,
  muted_until timestamptz,
  muted_always boolean NOT NULL DEFAULT false,
  PRIMARY KEY (conversation_id, account_id)
);
CREATE INDEX IF NOT EXISTS conversation_members_account ON conversation_members (account_id);

CREATE TABLE IF NOT EXISTS seals (
  viewer_id uuid NOT NULL REFERENCES accounts (id),
  contact_id uuid NOT NULL REFERENCES accounts (id),
  accepted_key_id text NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  PRIMARY KEY (viewer_id, contact_id)
);

CREATE TABLE IF NOT EXISTS letters (
  seq bigserial PRIMARY KEY,
  id uuid NOT NULL UNIQUE,
  conversation_id uuid NOT NULL REFERENCES conversations (id),
  sender_id uuid NOT NULL REFERENCES accounts (id),
  recipient_id uuid NOT NULL REFERENCES accounts (id),
  class text NOT NULL,
  state text NOT NULL,
  failure text,
  held_at timestamptz NOT NULL,
  delivered_at timestamptz,
  read_at timestamptz,
  returned_at timestamptz,
  retracted_at timestamptz,
  sender_key_id text NOT NULL,
  recipient_key_id text NOT NULL,
  iv bytea,
  ciphertext bytea,
  attachment_id uuid UNIQUE REFERENCES blobs (id),
  content_digest bytea NOT NULL
);
CREATE INDEX IF NOT EXISTS letters_recipient_held ON letters (recipient_id, seq) WHERE ciphertext IS NOT NULL;
CREATE INDEX IF NOT EXISTS letters_conversation ON letters (conversation_id, seq);
CREATE INDEX IF NOT EXISTS letters_sent_held_at ON letters (held_at) WHERE state = 'sent';

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id uuid NOT NULL REFERENCES accounts (id),
  blocked_id uuid NOT NULL REFERENCES accounts (id),
  blocked_at timestamptz NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);
`;
