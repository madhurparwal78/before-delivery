import { Pool, type PoolClient } from "pg";

export interface Db {
  pool: Pool;
  query: Pool["query"];
  tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
}

export function createDb(databaseUrl: string): Db {
  const pool = new Pool({ connectionString: databaseUrl, max: 10 });
  const query = pool.query.bind(pool);
  return {
    pool,
    query,
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
  };
}

/** The app applies its schema idempotently every time it starts serving. */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  skip_filled BOOLEAN NOT NULL DEFAULT TRUE,
  jump_next_clue BOOLEAN NOT NULL DEFAULT FALSE,
  autocheck BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS puzzles (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  cols INT NOT NULL,
  rows INT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('library','upload')),
  fixture TEXT,
  uploader_id TEXT REFERENCES players(id),
  sha256 TEXT,
  blocks JSONB NOT NULL,
  numbers JSONB NOT NULL,
  clues JSONB NOT NULL,
  solution JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS puzzles_uploader_idx ON puzzles(uploader_id);

CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  puzzle_id TEXT NOT NULL REFERENCES puzzles(id),
  host_player_id TEXT NOT NULL REFERENCES players(id),
  code TEXT UNIQUE,
  prev_code TEXT,
  link_state TEXT NOT NULL DEFAULT 'active' CHECK (link_state IN ('active','off')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','live','paused','solved')),
  timer_state TEXT NOT NULL DEFAULT 'paused' CHECK (timer_state IN ('running','paused','solved')),
  mode TEXT NOT NULL DEFAULT 'shared' CHECK (mode IN ('shared','race')),
  race_state TEXT CHECK (race_state IN ('lobby','racing','finished')),
  scores JSONB,
  seq INT NOT NULL DEFAULT 0,
  revealed_count INT NOT NULL DEFAULT 0,
  checked_count INT NOT NULL DEFAULT 0,
  solved_at TIMESTAMPTZ,
  solved_seq INT,
  solved_elapsed_ms BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS games_code_idx ON games(code);

CREATE TABLE IF NOT EXISTS seats (
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id),
  colour TEXT NOT NULL,
  team INT CHECK (team IN (1,2)),
  score INT NOT NULL DEFAULT 0,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, player_id)
);
CREATE INDEX IF NOT EXISTS seats_player_idx ON seats(player_id);

CREATE TABLE IF NOT EXISTS timer_segments (
  id BIGSERIAL PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS timer_segments_game_idx ON timer_segments(game_id);

CREATE TABLE IF NOT EXISTS squares (
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  team INT NOT NULL DEFAULT 0 CHECK (team IN (0,1,2)),
  row INT NOT NULL,
  col INT NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  pencil BOOLEAN NOT NULL DEFAULT FALSE,
  state TEXT NOT NULL DEFAULT 'empty' CHECK (state IN ('empty','filled','pencil','wrong','right','revealed')),
  owner TEXT,
  PRIMARY KEY (game_id, team, row, col)
);

CREATE TABLE IF NOT EXISTS ops (
  seq INT NOT NULL,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('cell','check','reveal','clear','claim')),
  by TEXT NOT NULL REFERENCES players(id),
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  client_op_id TEXT,
  team INT,
  data JSONB NOT NULL,
  PRIMARY KEY (game_id, seq)
);
CREATE INDEX IF NOT EXISTS ops_client_idx ON ops(game_id, by, client_op_id);

CREATE TABLE IF NOT EXISTS presence (
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id),
  connections INT NOT NULL DEFAULT 0,
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, player_id)
);

CREATE TABLE IF NOT EXISTS client_op_results (
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id),
  client_op_id TEXT NOT NULL,
  body JSONB NOT NULL,
  response JSONB NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, player_id, client_op_id)
);

CREATE TABLE IF NOT EXISTS history (
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id),
  puzzle_id TEXT NOT NULL REFERENCES puzzles(id),
  puzzle_title TEXT NOT NULL,
  cols INT NOT NULL,
  rows INT NOT NULL,
  elapsed_ms BIGINT NOT NULL,
  solved_at TIMESTAMPTZ NOT NULL,
  revealed_count INT NOT NULL,
  checked_count INT NOT NULL,
  stats JSONB NOT NULL,
  record_ready BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (game_id, player_id)
);
CREATE INDEX IF NOT EXISTS history_player_idx ON history(player_id, solved_at DESC);

CREATE TABLE IF NOT EXISTS cursors (
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id),
  team INT,
  row INT NOT NULL,
  col INT NOT NULL,
  direction TEXT NOT NULL,
  PRIMARY KEY (game_id, player_id)
);

CREATE TABLE IF NOT EXISTS pending_records (
  game_id TEXT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT
);
`;
