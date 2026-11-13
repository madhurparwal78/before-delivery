import { Pool, type PoolClient } from 'pg';
import { config } from './config.js';

export const pool = new Pool({ connectionString: config.databaseUrl, max: 12 });

export type Db = Pool | PoolClient;

const SCHEMA = `
create table if not exists accounts (
  id uuid primary key,
  username text not null unique,
  read_receipts boolean not null default true,
  preview text not null default 'name_and_letter',
  profile_iv text,
  profile_ciphertext text,
  profile_photo_blob_id uuid,
  recovery_salt bytea not null,
  recovery_hash bytea not null,
  username_changed_at timestamptz(3),
  created_at timestamptz(3) not null
);

create table if not exists account_keys (
  account_id uuid not null references accounts(id) on delete cascade,
  key_id text not null,
  public_key bytea not null,
  created_at timestamptz(3) not null,
  is_current boolean not null,
  primary key (account_id, key_id)
);

create table if not exists key_backups (
  account_id uuid not null references accounts(id) on delete cascade,
  key_id text not null,
  iv text not null,
  ciphertext text not null,
  created_at timestamptz(3) not null,
  primary key (account_id, key_id)
);

create table if not exists sessions (
  token_hash bytea primary key,
  account_id uuid not null references accounts(id) on delete cascade,
  created_at timestamptz(3) not null
);

create table if not exists username_holds (
  username text primary key,
  released_at timestamptz(3) not null,
  held_until timestamptz(3) not null
);

create table if not exists conversations (
  id uuid primary key,
  peer_a uuid not null references accounts(id) on delete cascade,
  peer_b uuid not null references accounts(id) on delete cascade,
  starter_id uuid not null references accounts(id) on delete cascade,
  created_at timestamptz(3) not null,
  updated_at timestamptz(3) not null,
  unique (peer_a, peer_b)
);

create table if not exists conversation_sides (
  conversation_id uuid not null references conversations(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  accepted boolean not null,
  visible boolean not null,
  read_seq bigint not null default 0,
  hide_seq bigint not null default 0,
  muted_until timestamptz(3),
  muted_always boolean not null default false,
  primary key (conversation_id, account_id)
);

create table if not exists seals (
  viewer_id uuid not null references accounts(id) on delete cascade,
  contact_id uuid not null references accounts(id) on delete cascade,
  accepted_key_id text not null,
  verified boolean not null default false,
  primary key (viewer_id, contact_id)
);

create table if not exists letters (
  id uuid primary key,
  seq bigint generated always as identity,
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender_id uuid not null references accounts(id) on delete cascade,
  recipient_id uuid not null references accounts(id) on delete cascade,
  letter_class text not null,
  state text not null,
  failure text,
  held_at timestamptz(3) not null,
  delivered_at timestamptz(3),
  read_at timestamptz(3),
  returned_at timestamptz(3),
  retracted_at timestamptz(3),
  sender_key_id text not null,
  recipient_key_id text not null,
  iv text,
  ciphertext text,
  attachment_id uuid,
  dropped boolean not null default false
);

create unique index if not exists letters_seq_key on letters(seq);
create index if not exists letters_conversation_seq on letters(conversation_id, seq);
create index if not exists letters_recipient_state on letters(recipient_id, state);
create index if not exists letters_state_held_at on letters(state, held_at);
create unique index if not exists letters_attachment_key on letters(attachment_id) where attachment_id is not null;

create table if not exists blobs (
  id uuid primary key,
  owner_id uuid not null references accounts(id) on delete cascade,
  kind text not null,
  size bigint not null,
  state text not null,
  created_at timestamptz(3) not null
);

create table if not exists blocks (
  blocker_id uuid not null references accounts(id) on delete cascade,
  blocked_id uuid not null references accounts(id) on delete cascade,
  blocked_at timestamptz(3) not null,
  primary key (blocker_id, blocked_id)
);

create table if not exists clock_offset (
  id integer primary key,
  offset_ms bigint not null
);
`;

export async function connectWithRetry(): Promise<void> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const client = await pool.connect();
      client.release();
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

export async function applySchema(): Promise<void> {
  await pool.query(SCHEMA);
}

export async function transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await run(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
