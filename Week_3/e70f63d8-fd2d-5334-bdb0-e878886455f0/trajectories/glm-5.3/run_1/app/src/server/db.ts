import pg, { type PoolClient, type QueryResultRow } from "pg";

const { Pool } = pg;
import { config } from "./config.js";

// The schema is applied idempotently on every serve.
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users (lower(email));

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  organiser_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  logo_key TEXT,
  logo_upload_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  batting_order INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS players_team_short ON players (team_id, short_name);

CREATE TABLE IF NOT EXISTS tournaments (
  id TEXT PRIMARY KEY,
  organiser_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  overs INTEGER NOT NULL,
  players_per_side INTEGER NOT NULL,
  super_over BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tournament_groups (
  id TEXT PRIMARY KEY,
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tournament_group_teams (
  group_id TEXT NOT NULL REFERENCES tournament_groups(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, team_id)
);

CREATE TABLE IF NOT EXISTS matches (
  id TEXT PRIMARY KEY,
  organiser_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  home_team_id TEXT NOT NULL REFERENCES teams(id),
  away_team_id TEXT NOT NULL REFERENCES teams(id),
  tournament_id TEXT REFERENCES tournaments(id),
  overs INTEGER NOT NULL,
  players_per_side INTEGER NOT NULL,
  super_over BOOLEAN NOT NULL,
  batting_first TEXT NOT NULL REFERENCES teams(id),
  viewer_link BOOLEAN NOT NULL DEFAULT true,
  viewer_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',
  result TEXT,
  played_on DATE,
  summary_first_runs INTEGER,
  summary_first_wickets INTEGER,
  summary_first_balls INTEGER,
  summary_first_all_out BOOLEAN,
  summary_second_runs INTEGER,
  summary_second_wickets INTEGER,
  summary_second_balls INTEGER,
  summary_second_all_out BOOLEAN,
  summary_winner TEXT REFERENCES teams(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS matches_viewer_code ON matches (viewer_code);

CREATE TABLE IF NOT EXISTS match_xi (
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL REFERENCES teams(id),
  player_id TEXT NOT NULL REFERENCES players(id),
  batting_order INTEGER NOT NULL,
  PRIMARY KEY (match_id, player_id)
);

CREATE TABLE IF NOT EXISTS innings (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  label TEXT NOT NULL, -- "1", "2", "so1-1", "so1-2"
  batting_team_id TEXT NOT NULL REFERENCES teams(id),
  bowling_team_id TEXT NOT NULL REFERENCES teams(id),
  striker TEXT,
  non_striker TEXT,
  bowler TEXT,
  super_over_number INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ,
  ended BOOLEAN NOT NULL DEFAULT false,
  seq INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS innings_match_label ON innings (match_id, label);

CREATE TABLE IF NOT EXISTS deliveries (
  id TEXT PRIMARY KEY,
  innings_id TEXT NOT NULL REFERENCES innings(id) ON DELETE CASCADE,
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  striker TEXT NOT NULL,
  bowler TEXT NOT NULL,
  extra TEXT NOT NULL,
  runs INTEGER NOT NULL,
  wicket_kind TEXT,
  wicket_fielder TEXT,
  wicket_batter_out TEXT,
  wicket_new_batter TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS deliveries_innings_seq ON deliveries (innings_id, seq);

CREATE TABLE IF NOT EXISTS retirements (
  id TEXT PRIMARY KEY,
  innings_id TEXT NOT NULL REFERENCES innings(id) ON DELETE CASCADE,
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  batter TEXT NOT NULL,
  new_batter TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS retirements_innings_seq ON retirements (innings_id, seq);

CREATE TABLE IF NOT EXISTS over_starts (
  id TEXT PRIMARY KEY,
  innings_id TEXT NOT NULL REFERENCES innings(id) ON DELETE CASCADE,
  over_number INTEGER NOT NULL,
  bowler TEXT NOT NULL,
  UNIQUE (innings_id, over_number)
);

CREATE TABLE IF NOT EXISTS match_scorers (
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (match_id, user_id)
);

CREATE TABLE IF NOT EXISTS invitations (
  token TEXT PRIMARY KEY,
  match_id TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  accepted_by TEXT REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS invitations_match ON invitations (match_id);
`;

export interface Db {
  query<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<T[]>;
  withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
}

export const createDb = async (retriesSeconds = 60): Promise<Db> => {
  const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });
  const started = Date.now();
  for (;;) {
    try {
      await pool.query("SELECT 1");
      break;
    } catch {
      if (Date.now() - started >= retriesSeconds * 1000) throw new Error("Postgres unreachable at boot");
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  await pool.query(SCHEMA_SQL);
  return {
    async query<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<T[]> {
      const res = await pool.query<T>(sql, params as never[]);
      return res.rows;
    },
    async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const out = await fn(client);
        await client.query("COMMIT");
        return out;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },
  };
};
