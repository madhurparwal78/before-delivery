import pg from 'pg'
import { config } from './config.ts'

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12 })

// Counts come back as numbers, as the API speaks them.
pg.types.setTypeParser(20, (value) => Number(value))

export type Queryable = Pick<pg.Pool, 'query'>

const SCHEMA = `
CREATE TABLE IF NOT EXISTS players (
  id uuid PRIMARY KEY,
  display_name text NOT NULL,
  skip_filled boolean NOT NULL DEFAULT true,
  jump_next_clue boolean NOT NULL DEFAULT false,
  autocheck boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS puzzles (
  id uuid PRIMARY KEY,
  ordinal bigserial,
  title text NOT NULL,
  author text NOT NULL,
  cols int NOT NULL,
  rows int NOT NULL,
  source text NOT NULL,
  fixture text UNIQUE,
  sha256 text,
  owner_id uuid REFERENCES players (id),
  solution jsonb NOT NULL,
  numbers jsonb NOT NULL,
  clues jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS games (
  id uuid PRIMARY KEY,
  puzzle_id uuid NOT NULL REFERENCES puzzles (id),
  host_id uuid NOT NULL REFERENCES players (id),
  mode text NOT NULL DEFAULT 'shared',
  race_state text,
  status text NOT NULL DEFAULT 'open',
  seq int NOT NULL DEFAULT 0,
  checked_count int NOT NULL DEFAULT 0,
  solved_at timestamptz,
  initial jsonb NOT NULL DEFAULT '[]',
  stats jsonb,
  record_written boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS link_codes (
  code text PRIMARY KEY,
  game_id uuid NOT NULL REFERENCES games (id),
  state text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS link_codes_game ON link_codes (game_id);
CREATE TABLE IF NOT EXISTS seats (
  game_id uuid NOT NULL REFERENCES games (id),
  player_id uuid NOT NULL REFERENCES players (id),
  seat int NOT NULL,
  colour text NOT NULL,
  team int,
  score int NOT NULL DEFAULT 0,
  has_access boolean NOT NULL DEFAULT true,
  PRIMARY KEY (game_id, player_id)
);
CREATE TABLE IF NOT EXISTS squares (
  game_id uuid NOT NULL REFERENCES games (id),
  grid int NOT NULL,
  row int NOT NULL,
  col int NOT NULL,
  value text NOT NULL,
  pencil boolean NOT NULL,
  state text NOT NULL,
  owner text,
  PRIMARY KEY (game_id, grid, row, col)
);
CREATE TABLE IF NOT EXISTS ops (
  game_id uuid NOT NULL REFERENCES games (id),
  seq int NOT NULL,
  player_id uuid NOT NULL REFERENCES players (id),
  client_op_id text,
  fingerprint text NOT NULL,
  op jsonb NOT NULL,
  message jsonb NOT NULL,
  PRIMARY KEY (game_id, seq)
);
CREATE UNIQUE INDEX IF NOT EXISTS ops_client_op ON ops (game_id, player_id, client_op_id) WHERE client_op_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS timer_segments (
  game_id uuid NOT NULL REFERENCES games (id),
  idx int NOT NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  PRIMARY KEY (game_id, idx)
);
CREATE TABLE IF NOT EXISTS history_entries (
  game_id uuid NOT NULL REFERENCES games (id),
  player_id uuid NOT NULL REFERENCES players (id),
  PRIMARY KEY (game_id, player_id)
);
`

const SCHEMA_LOCK = 4_173_001
const RETRY_MS = 1000

/** Applies the schema idempotently, retrying every second until Postgres answers. */
export async function migrate(): Promise<void> {
  for (;;) {
    try {
      const client = await pool.connect()
      try {
        await client.query('SELECT pg_advisory_lock($1)', [SCHEMA_LOCK])
        await client.query(SCHEMA)
      } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [SCHEMA_LOCK]).catch(() => undefined)
        client.release()
      }
      return
    } catch (error) {
      console.error('Postgres is not ready:', error instanceof Error ? error.message : error)
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS))
    }
  }
}

export async function transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}
