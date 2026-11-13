import { Client, Pool, types } from 'pg';
import { config } from './config.js';

// int8 columns hold values bounded by the published limits, all within the
// JSON safe-integer range; parse them as numbers for exact wire integers.
types.setTypeParser(20, (value: string) => Number(value));

export const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });

export async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client as unknown as Client);
  } finally {
    client.release();
  }
}

export async function withTransaction<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client as unknown as Client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  email_normalized TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  player_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS levels (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  title TEXT NOT NULL,
  state TEXT NOT NULL,
  revision INT8 NOT NULL DEFAULT 1,
  definition JSONB NOT NULL,
  level_digest TEXT NOT NULL,
  challenge_digest TEXT,
  proof_run_id TEXT,
  ruleset TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  mode TEXT NOT NULL,
  source_id TEXT NOT NULL,
  revision INT8,
  seed INT8 NOT NULL,
  level_digest TEXT NOT NULL,
  loadout JSONB NOT NULL,
  ruleset TEXT NOT NULL,
  initial_reserve INT8 NOT NULL,
  initial_health INT8 NOT NULL,
  season_day TEXT,
  daily BOOLEAN NOT NULL DEFAULT false,
  definition JSONB NOT NULL,
  state TEXT NOT NULL DEFAULT 'issued',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS staged_evidence (
  ticket_id TEXT PRIMARY KEY REFERENCES tickets(id),
  evidence_digest TEXT NOT NULL,
  commands JSONB NOT NULL,
  end_tick INT8 NOT NULL,
  staged_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS runs (
  ticket_id TEXT PRIMARY KEY REFERENCES tickets(id),
  state TEXT NOT NULL,
  evidence_digest TEXT,
  outcome TEXT,
  breaches INT8,
  completion_tick INT8,
  remaining_charge INT8,
  health INT8,
  failure_tick INT8,
  failure_seq INT8,
  failure_reason TEXT,
  ledger JSONB,
  accepted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS runs_one_result_per_ticket ON runs (ticket_id);

CREATE TABLE IF NOT EXISTS proofs (
  run_id TEXT PRIMARY KEY,
  level_id TEXT NOT NULL REFERENCES levels(id),
  revision INT8 NOT NULL,
  state TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS completions (
  account_id TEXT NOT NULL REFERENCES accounts(id),
  encounter_id TEXT NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, encounter_id)
);

CREATE TABLE IF NOT EXISTS challenge_publications (
  digest TEXT PRIMARY KEY,
  level_id TEXT NOT NULL,
  ruleset TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  creator_name TEXT NOT NULL,
  definition JSONB NOT NULL,
  level_digest TEXT NOT NULL,
  proof_run_id TEXT NOT NULL,
  committed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  unlisted BOOLEAN NOT NULL DEFAULT false,
  unlisted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS index_work (
  id BIGSERIAL PRIMARY KEY,
  digest TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS index_work_pending_unique ON index_work (digest) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS season_days (
  season_day TEXT PRIMARY KEY,
  daily_digest TEXT,
  selected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS playback (
  result_id TEXT PRIMARY KEY,
  version INT8 NOT NULL DEFAULT 0,
  tick INT8 NOT NULL DEFAULT 0,
  playing BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

let schemaReady = false;

export async function ensureSchema(): Promise<void> {
  if (schemaReady) return;
  await withClient(async (client) => {
    await client.query(SCHEMA_SQL);
  });
  schemaReady = true;
}

export function markSchemaNeedsRetry(): void {
  schemaReady = false;
}
