import { Pool, types } from 'pg';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { ApiError } from './errors.js';
import type { DatabaseConfig } from './config.js';

export const UNIQUE_VIOLATION = '23505';
const SERIALIZATION_FAILURE = '40001';

const INT8_OID = 20;
types.setTypeParser(INT8_OID, (value) => Number(value));

export class Database {
  private readonly pool: Pool;

  constructor(config: DatabaseConfig) {
    this.pool = new Pool({ connectionString: config.url, max: 10, connectionTimeoutMillis: 2000, query_timeout: 5000, statement_timeout: 5000 });
    this.pool.on('error', () => undefined);
  }

  async query<R extends QueryResultRow>(text: string, values: unknown[] = []): Promise<QueryResult<R>> {
    try {
      return await this.pool.query<R>(text, values);
    } catch (error) {
      throw translate(error);
    }
  }

  async transaction<T>(work: (client: Client) => Promise<T>): Promise<T> {
    let client: PoolClient;
    try {
      client = await this.pool.connect();
    } catch (error) {
      throw translate(error);
    }
    try {
      await client.query('BEGIN');
      const result = await work(new Client(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error instanceof ApiError || isIntegrity(error) ? error : translate(error);
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export class Client {
  constructor(private readonly client: PoolClient) {}

  async query<R extends QueryResultRow>(text: string, values: unknown[] = []): Promise<QueryResult<R>> {
    return this.client.query<R>(text, values);
  }
}

function isIntegrity(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === UNIQUE_VIOLATION || code === SERIALIZATION_FAILURE;
}

function translate(error: unknown): unknown {
  if (error instanceof ApiError || isIntegrity(error)) return error;
  process.stderr.write('[database] operation unavailable\n');
  return new ApiError('DATABASE_UNAVAILABLE');
}

export function pgCode(error: unknown): string | null {
  const code = (error as { code?: string } | null)?.code;
  return typeof code === 'string' ? code : null;
}

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id text PRIMARY KEY,
  email text NOT NULL,
  email_normalized text NOT NULL UNIQUE,
  player_name text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id),
  revoked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campaign_encounters (
  id text PRIMARY KEY,
  position int8 NOT NULL,
  title text NOT NULL,
  definition jsonb NOT NULL,
  digest text NOT NULL
);

CREATE TABLE IF NOT EXISTS levels (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id),
  revision int8 NOT NULL,
  state text NOT NULL,
  title text NOT NULL,
  definition jsonb NOT NULL,
  digest text NOT NULL,
  proof_run_id text,
  challenge_digest text,
  pending_proof_run_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS level_revisions (
  level_id text NOT NULL REFERENCES levels(id),
  revision int8 NOT NULL,
  definition jsonb NOT NULL,
  digest text NOT NULL,
  PRIMARY KEY (level_id, revision)
);
INSERT INTO level_revisions (level_id, revision, definition, digest)
  SELECT id, revision, definition, digest FROM levels ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS tickets (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id),
  mode text NOT NULL,
  source_id text NOT NULL,
  revision int8,
  seed int8 NOT NULL,
  level_digest text NOT NULL,
  loadout jsonb NOT NULL,
  ruleset text NOT NULL,
  initial_reserve int8 NOT NULL,
  initial_health int8 NOT NULL,
  season_day text,
  daily boolean NOT NULL,
  definition jsonb NOT NULL,
  challenge_digest text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS runs (
  id text PRIMARY KEY REFERENCES tickets(id),
  account_id text NOT NULL REFERENCES accounts(id),
  state text NOT NULL,
  evidence_digest text,
  commands jsonb,
  end_tick int8,
  outcome text,
  breaches int8,
  completion_tick int8,
  remaining_charge int8,
  health int8,
  failure jsonb,
  last_available_tick int8,
  commit_seq bigserial,
  committed_at timestamptz
);

ALTER TABLE runs ADD COLUMN IF NOT EXISTS outcome text;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS breaches int8;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS completion_tick int8;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS remaining_charge int8;
ALTER TABLE runs ADD COLUMN IF NOT EXISTS health int8;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'runs' AND column_name = 'metrics') THEN
    EXECUTE 'UPDATE runs SET outcome = metrics->>''outcome'', breaches = (metrics->>''breaches'')::int8,
      completion_tick = (metrics->>''completionTick'')::int8, remaining_charge = (metrics->>''remainingCharge'')::int8,
      health = (metrics->>''health'')::int8 WHERE metrics IS NOT NULL AND outcome IS NULL';
    EXECUTE 'ALTER TABLE runs DROP COLUMN metrics';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS ledger_entries (
  run_id text NOT NULL REFERENCES runs(id),
  ordinal int8 NOT NULL,
  movement_id int8 NOT NULL,
  tick int8 NOT NULL,
  account text NOT NULL,
  delta int8 NOT NULL,
  reason text NOT NULL,
  device_id int8,
  PRIMARY KEY (run_id, ordinal)
);

CREATE TABLE IF NOT EXISTS completions (
  account_id text NOT NULL REFERENCES accounts(id),
  encounter_id text NOT NULL,
  run_id text NOT NULL REFERENCES runs(id),
  PRIMARY KEY (account_id, encounter_id)
);

CREATE TABLE IF NOT EXISTS proofs (
  run_id text PRIMARY KEY REFERENCES tickets(id),
  level_id text NOT NULL REFERENCES levels(id),
  account_id text NOT NULL REFERENCES accounts(id),
  revision int8 NOT NULL,
  state text NOT NULL
);

CREATE TABLE IF NOT EXISTS challenges (
  digest text PRIMARY KEY,
  level_id text NOT NULL REFERENCES levels(id),
  account_id text NOT NULL REFERENCES accounts(id),
  ruleset text NOT NULL,
  level_digest text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  difficulty text NOT NULL,
  creator_name text NOT NULL,
  definition jsonb NOT NULL,
  proof_run_id text NOT NULL,
  listed boolean NOT NULL DEFAULT true,
  published_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS index_work (
  digest text PRIMARY KEY,
  operation text NOT NULL,
  confirmed boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS daily_selection (
  season_day text PRIMARY KEY,
  digest text
);

CREATE TABLE IF NOT EXISTS presentations (
  run_id text PRIMARY KEY REFERENCES runs(id),
  version int8 NOT NULL DEFAULT 0,
  tick int8 NOT NULL DEFAULT 0,
  playing boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS levels_account_idx ON levels (account_id);
CREATE INDEX IF NOT EXISTS runs_account_idx ON runs (account_id);
CREATE INDEX IF NOT EXISTS tickets_challenge_idx ON tickets (challenge_digest);
CREATE INDEX IF NOT EXISTS proofs_level_idx ON proofs (level_id);
`;
