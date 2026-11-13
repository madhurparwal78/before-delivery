import type { Pool, PoolClient } from 'pg';

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS scores (
  id text PRIMARY KEY,
  title text NOT NULL,
  measure_count int NOT NULL,
  lamport bigint NOT NULL,
  last_seq bigint NOT NULL,
  time_signatures jsonb NOT NULL,
  tempos jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS staves (
  id text NOT NULL,
  score_id text NOT NULL,
  name text NOT NULL,
  clef text NOT NULL,
  transpose jsonb NOT NULL,
  part_id text NOT NULL,
  "order" int NOT NULL,
  PRIMARY KEY (score_id, id)
);

CREATE TABLE IF NOT EXISTS parts (
  id text NOT NULL,
  score_id text NOT NULL,
  name text NOT NULL,
  status text NOT NULL,
  revision int NOT NULL,
  extracted_at_lamport bigint,
  stale boolean NOT NULL DEFAULT false,
  page_count int,
  layout jsonb NOT NULL,
  last_error text,
  PRIMARY KEY (score_id, id)
);

CREATE TABLE IF NOT EXISTS collaborators (
  id text NOT NULL,
  score_id text NOT NULL,
  name text NOT NULL,
  role text NOT NULL,
  status text NOT NULL,
  staff_ids jsonb NOT NULL,
  seat_token text UNIQUE,
  PRIMARY KEY (score_id, id)
);

CREATE TABLE IF NOT EXISTS invites (
  token text PRIMARY KEY,
  score_id text NOT NULL,
  collaborator_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS operations (
  score_id text NOT NULL,
  seq bigint NOT NULL,
  lamport bigint NOT NULL,
  site text NOT NULL,
  author_id text NOT NULL,
  op jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (score_id, seq)
);

CREATE TABLE IF NOT EXISTS acks (
  score_id text NOT NULL,
  collaborator_id text NOT NULL,
  seen bigint NOT NULL,
  PRIMARY KEY (score_id, collaborator_id)
);

CREATE TABLE IF NOT EXISTS snapshots (
  score_id text NOT NULL,
  seq bigint NOT NULL,
  lamport bigint NOT NULL,
  state jsonb NOT NULL,
  PRIMARY KEY (score_id, seq)
);

CREATE TABLE IF NOT EXISTS holds (
  score_id text NOT NULL,
  staff_id text NOT NULL,
  holder_id text NOT NULL,
  connection_id text NOT NULL,
  since timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (score_id, staff_id)
);

CREATE TABLE IF NOT EXISTS banks (
  id text NOT NULL,
  score_id text NOT NULL,
  file_name text NOT NULL,
  kind text NOT NULL,
  bytes bigint NOT NULL,
  staff_id text NOT NULL,
  root_pitch text,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (score_id, id)
);

CREATE INDEX IF NOT EXISTS operations_score_seq ON operations (score_id, seq);
CREATE INDEX IF NOT EXISTS banks_created ON banks (score_id, created_at DESC);
`;

/** Applied idempotently every time the server starts. */
export async function applySchema(pool: Pool): Promise<void> {
  await pool.query(SCHEMA_SQL);
}

export interface Tx {
  query(text: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

export async function withTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // connection already broken
    }
    throw err;
  } finally {
    client.release();
  }
}
