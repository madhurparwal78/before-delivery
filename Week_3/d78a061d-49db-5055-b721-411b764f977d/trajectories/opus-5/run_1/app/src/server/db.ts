import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { config } from './config.js';

export const pool = new Pool({ connectionString: config.databaseUrl, max: 12 });

export async function query<T extends QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(sql, params as unknown[]);
  return result.rows;
}

export async function one<T extends QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  email_lower text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  display_name_lower text NOT NULL UNIQUE,
  locale text NOT NULL,
  email_verified boolean NOT NULL DEFAULT false,
  verification_email text NOT NULL DEFAULT 'not_sent',
  storage_notice text,
  equipped_character_id uuid,
  weapon_counter integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS characters (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  slot integer NOT NULL,
  revision integer NOT NULL,
  name text NOT NULL,
  parts jsonb NOT NULL,
  proportions jsonb NOT NULL,
  pose jsonb NOT NULL,
  material text NOT NULL,
  accessories jsonb NOT NULL,
  model_id uuid,
  weapon_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, slot)
);

CREATE TABLE IF NOT EXISTS weapons (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  number integer NOT NULL,
  strokes jsonb NOT NULL,
  stats jsonb NOT NULL,
  vertices integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS models (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  filename text NOT NULL,
  size_bytes bigint NOT NULL,
  sha256 text NOT NULL,
  status text NOT NULL,
  rulebook_version text,
  report jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS friend_requests (
  id uuid PRIMARY KEY,
  from_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  to_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  client_request_id text NOT NULL,
  state text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_id, client_request_id)
);

CREATE TABLE IF NOT EXISTS friendships (
  low_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  high_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (low_id, high_id)
);

CREATE TABLE IF NOT EXISTS parties (
  id uuid PRIMARY KEY,
  status text NOT NULL,
  leader_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  story_id text NOT NULL,
  session_id uuid,
  ready_deadline_at bigint,
  ready_started_members jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE parties ADD COLUMN IF NOT EXISTS ready_started_members jsonb;

CREATE TABLE IF NOT EXISTS party_members (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  party_id uuid NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  ready_response text
);

CREATE TABLE IF NOT EXISTS party_invites (
  id uuid PRIMARY KEY,
  party_id uuid NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  to_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  state text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS event_streams (
  stream text PRIMARY KEY,
  last_seq bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS events (
  stream text NOT NULL,
  seq bigint NOT NULL,
  event_id uuid NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (stream, seq)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id uuid PRIMARY KEY,
  channel text NOT NULL,
  seq bigint NOT NULL,
  kind text NOT NULL,
  author_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  body text,
  code text,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  client_message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel, seq)
);
CREATE UNIQUE INDEX IF NOT EXISTS chat_messages_idem
  ON chat_messages (channel, author_id, client_message_id)
  WHERE client_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS game_sessions (
  id uuid PRIMARY KEY,
  story_id text NOT NULL,
  chapter integer NOT NULL,
  mode text NOT NULL,
  status text NOT NULL,
  tick bigint NOT NULL,
  gate_open boolean NOT NULL,
  checkpoint_reached boolean NOT NULL,
  motes jsonb NOT NULL,
  members jsonb NOT NULL,
  party_id uuid,
  owner_account_id uuid,
  stepper_id text,
  stepper_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS processed_intents (
  session_id uuid NOT NULL,
  account_id uuid NOT NULL,
  intent_id text NOT NULL,
  tick bigint NOT NULL,
  applied boolean NOT NULL,
  reason text,
  PRIMARY KEY (session_id, account_id, intent_id)
);

CREATE TABLE IF NOT EXISTS solo_progress (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  story_id text NOT NULL,
  unlocked_chapter integer NOT NULL DEFAULT 1,
  completed_chapters jsonb NOT NULL DEFAULT '[]'::jsonb,
  checkpoint jsonb,
  PRIMARY KEY (account_id, story_id)
);

CREATE TABLE IF NOT EXISTS party_progress (
  party_id uuid NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  story_id text NOT NULL,
  unlocked_chapter integer NOT NULL DEFAULT 1,
  completed_chapters jsonb NOT NULL DEFAULT '[]'::jsonb,
  checkpoint jsonb,
  PRIMARY KEY (party_id, story_id)
);

CREATE TABLE IF NOT EXISTS email_tokens (
  token text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  replaced boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS realtime_connections (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  joined_session_id uuid,
  copy_id text NOT NULL,
  last_heartbeat timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS realtime_connections_account ON realtime_connections (account_id);
CREATE INDEX IF NOT EXISTS realtime_connections_session ON realtime_connections (joined_session_id);

CREATE TABLE IF NOT EXISTS chat_rate_events (
  id bigserial PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  channel text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_rate_events_lookup
  ON chat_rate_events (account_id, channel, created_at);
`;

let ready = false;

export function isDbReady(): boolean {
  return ready;
}

export async function connectWithRetry(): Promise<void> {
  for (;;) {
    try {
      await pool.query('SELECT 1');
      ready = true;
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

export async function createSchema(): Promise<void> {
  await pool.query(SCHEMA);
}
