import type { Pool } from "pg";

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  handle TEXT NOT NULL,
  handle_lower TEXT NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_handle_lower_key ON users (handle_lower);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (email);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  token TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS tokens_token_key ON tokens (token);

CREATE TABLE IF NOT EXISTS friendships (
  user_a INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  user_b INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  since TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_a, user_b),
  CHECK (user_a < user_b)
);

CREATE TABLE IF NOT EXISTS friend_requests (
  id SERIAL PRIMARY KEY,
  from_user INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  to_user INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (from_user <> to_user)
);
CREATE UNIQUE INDEX IF NOT EXISTS friend_requests_pair_key ON friend_requests (least(from_user, to_user), greatest(from_user, to_user));

CREATE TABLE IF NOT EXISTS blocks (
  blocker INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  blocked INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker, blocked),
  CHECK (blocker <> blocked)
);

CREATE TABLE IF NOT EXISTS parties (
  id SERIAL PRIMARY KEY,
  state TEXT NOT NULL DEFAULT 'idle',
  leader_id INTEGER NOT NULL REFERENCES users (id),
  lobby_id INTEGER,
  match_id INTEGER,
  queued_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS parties_state_queued_idx ON parties (state, queued_at, id);

CREATE TABLE IF NOT EXISTS party_members (
  party_id INTEGER NOT NULL REFERENCES parties (id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (party_id, user_id)
);

CREATE TABLE IF NOT EXISTS party_invites (
  id SERIAL PRIMARY KEY,
  from_user INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  to_user INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  party_id INTEGER NOT NULL REFERENCES parties (id),
  state TEXT NOT NULL DEFAULT 'open',
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS party_invites_open_key ON party_invites (to_user, from_user) WHERE state = 'open';

CREATE TABLE IF NOT EXISTS lobbies (
  id SERIAL PRIMARY KEY,
  state TEXT NOT NULL DEFAULT 'filling',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  countdown_ends_at TIMESTAMPTZ,
  match_id INTEGER
);

CREATE TABLE IF NOT EXISTS lobby_seats (
  lobby_id INTEGER NOT NULL REFERENCES lobbies (id) ON DELETE CASCADE,
  seat INTEGER NOT NULL CHECK (seat >= 1 AND seat <= 12),
  user_id INTEGER NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  party_id INTEGER NOT NULL REFERENCES parties (id),
  seated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (lobby_id, seat)
);

CREATE TABLE IF NOT EXISTS matches (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'running',
  lobby_id INTEGER NOT NULL REFERENCES lobbies (id),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  winner_id INTEGER REFERENCES users (id)
);

CREATE TABLE IF NOT EXISTS rounds (
  match_id INTEGER NOT NULL REFERENCES matches (id) ON DELETE CASCADE,
  n INTEGER NOT NULL,
  kind TEXT NOT NULL,
  seed BIGINT NOT NULL CHECK (seed >= 0 AND seed <= 4294967295),
  state TEXT NOT NULL DEFAULT 'pending',
  slots INTEGER NOT NULL,
  starters INTEGER[] NOT NULL,
  last_tick INTEGER,
  started_at TIMESTAMPTZ,
  PRIMARY KEY (match_id, n)
);

CREATE TABLE IF NOT EXISTS round_results (
  match_id INTEGER NOT NULL,
  round_n INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  finish_tick INTEGER,
  eliminated_tick INTEGER,
  position INTEGER NOT NULL,
  PRIMARY KEY (match_id, round_n, user_id)
);

CREATE TABLE IF NOT EXISTS round_inputs (
  match_id INTEGER NOT NULL,
  round_n INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  tick INTEGER NOT NULL,
  buttons INTEGER NOT NULL,
  PRIMARY KEY (match_id, round_n, user_id, tick)
);

CREATE TABLE IF NOT EXISTS forfeits (
  match_id INTEGER NOT NULL,
  round_n INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  tick INTEGER NOT NULL,
  PRIMARY KEY (match_id, round_n, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  channel TEXT NOT NULL,
  party_id INTEGER,
  from_user INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  to_user INTEGER,
  body TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_party_idx ON messages (party_id, id);
CREATE INDEX IF NOT EXISTS messages_dm_idx ON messages (from_user, to_user, id);
`;

async function migrate(pool: Pool): Promise<void> {
  const addColumn = async (table: string, column: string, ddl: string) => {
    const found = await pool.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
      [table, column]
    );
    if (found.rowCount === 0) {
      await pool.query(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    }
  };
  await addColumn("party_invites", "state", "party_invites.state TEXT NOT NULL DEFAULT 'open'");
  const constraint = await pool.query(`SELECT 1 FROM pg_constraint WHERE conname = 'parties_leader_fkey'`);
  if (constraint.rowCount === 0) {
    await pool.query(`ALTER TABLE parties ADD CONSTRAINT parties_leader_fkey FOREIGN KEY (leader_id) REFERENCES users (id)`);
  }
}

export async function applySchema(pool: Pool): Promise<void> {
  await pool.query(SCHEMA_SQL);
  await migrate(pool);
}
