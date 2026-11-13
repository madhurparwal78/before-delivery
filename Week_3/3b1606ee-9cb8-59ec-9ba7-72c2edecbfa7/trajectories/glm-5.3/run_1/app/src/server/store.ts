import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool, txQuery } from './db.js';

// Schema applied on every start without failing when it already exists. IF-04: state lives only here.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY,
  username TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  username_changed_at TIMESTAMPTZ,
  read_receipts BOOLEAN NOT NULL DEFAULT TRUE,
  preview TEXT NOT NULL,
  profile_iv TEXT,
  profile_ciphertext TEXT,
  profile_photo_blob_id UUID
);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_username_key ON accounts (username);

CREATE TABLE IF NOT EXISTS account_keys (
  key_id TEXT NOT NULL,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (account_id, key_id)
);

CREATE TABLE IF NOT EXISTS key_backups (
  key_id TEXT NOT NULL,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  iv TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (account_id, key_id)
);

CREATE TABLE IF NOT EXISTS recovery (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  salt TEXT NOT NULL,
  verifier_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY,
  starter_id UUID NOT NULL REFERENCES accounts(id),
  recipient_id UUID NOT NULL REFERENCES accounts(id),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS conversation_sides (
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id),
  status TEXT NOT NULL,
  read_through_seq BIGINT NOT NULL DEFAULT 0,
  muted_until TIMESTAMPTZ,
  mute_always BOOLEAN NOT NULL DEFAULT FALSE,
  accepted_key_id TEXT,
  seal_verified BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at TIMESTAMPTZ,
  PRIMARY KEY (conversation_id, account_id)
);

CREATE TABLE IF NOT EXISTS letters (
  id UUID PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  seq BIGSERIAL NOT NULL,
  sender_id UUID NOT NULL REFERENCES accounts(id),
  recipient_id UUID NOT NULL REFERENCES accounts(id),
  class TEXT NOT NULL,
  state TEXT NOT NULL,
  failure TEXT,
  held_at TIMESTAMPTZ NOT NULL,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  returned_at TIMESTAMPTZ,
  retracted_at TIMESTAMPTZ,
  sender_key_id TEXT NOT NULL,
  recipient_key_id TEXT NOT NULL,
  iv TEXT,
  ciphertext TEXT,
  attachment_id UUID,
  blocked_post BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE UNIQUE INDEX IF NOT EXISTS letters_seq_key ON letters (seq);
CREATE INDEX IF NOT EXISTS letters_conversation_idx ON letters (conversation_id, seq);
CREATE INDEX IF NOT EXISTS letters_recipient_idx ON letters (recipient_id, state, seq);

CREATE TABLE IF NOT EXISTS blobs (
  id UUID PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  size BIGINT NOT NULL,
  state TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id UUID NOT NULL REFERENCES accounts(id),
  blocked_id UUID NOT NULL REFERENCES accounts(id),
  blocked_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS name_holds (
  username TEXT PRIMARY KEY,
  held_until TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS recovery_attempts (
  username TEXT NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL,
  success BOOLEAN NOT NULL
);
CREATE INDEX IF NOT EXISTS recovery_attempts_idx ON recovery_attempts (username, attempted_at);
`;

export async function applySchema(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(SCHEMA);
  } finally {
    client.release();
  }
}

export function newId(): string {
  return randomUUID();
}

export async function nextSeq(client: PoolClient): Promise<number> {
  const rows = await txQuery<{ seq: string }>(client, `SELECT nextval('letters_seq_seq') AS seq`);
  return Number(rows[0].seq);
}
