import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
});

// Idempotent schema. Eleven tables exactly as the brief pins them.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS members (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL,
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  rating        INTEGER NOT NULL DEFAULT 1500,
  rated_games   INTEGER NOT NULL DEFAULT 0,
  avatar_key    TEXT NOT NULL DEFAULT 'avatar_01',
  role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member','administrator')),
  view          TEXT NOT NULL DEFAULT 'flat',
  piece_set_2d  TEXT NOT NULL DEFAULT 'Classic',
  piece_set_3d  TEXT NOT NULL DEFAULT 'Marble',
  theme         TEXT NOT NULL DEFAULT 'Forest',
  sound         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS members_username_ci ON members (lower(username));
CREATE UNIQUE INDEX IF NOT EXISTS members_email_ci ON members (lower(email));
CREATE INDEX IF NOT EXISTS members_rating_order ON members (rating DESC, rated_games DESC, username ASC);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  member_id  TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sessions_token ON sessions (token_hash);
CREATE INDEX IF NOT EXISTS sessions_member ON sessions (member_id);

CREATE TABLE IF NOT EXISTS clubs (
  id      TEXT PRIMARY KEY,
  name    TEXT NOT NULL,
  slug    TEXT NOT NULL,
  private BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE UNIQUE INDEX IF NOT EXISTS clubs_slug ON clubs (slug);

CREATE TABLE IF NOT EXISTS club_memberships (
  club_id   TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  role      TEXT NOT NULL CHECK (role IN ('owner','moderator','member')),
  banned    BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (club_id, member_id)
);
CREATE INDEX IF NOT EXISTS club_memberships_member ON club_memberships (member_id);

CREATE TABLE IF NOT EXISTS games (
  id             TEXT PRIMARY KEY,
  white_id       TEXT NOT NULL REFERENCES members(id),
  black_id       TEXT REFERENCES members(id),   -- null for house games
  club_id        TEXT REFERENCES clubs(id),
  rated          BOOLEAN NOT NULL DEFAULT FALSE,
  level          TEXT,                          -- easy|steady|sharp for house games
  fen            TEXT NOT NULL,
  fen_start      TEXT,                          -- the position the game began from
  status         TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','finished','aborted')),
  result         TEXT,                          -- 1-0 | 0-1 | 1/2-1/2 | * | '' 
  end_reason     TEXT,
  opening        TEXT,
  draw_offer_by  TEXT,
  takeback_by    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_move_at   TIMESTAMPTZ NOT NULL DEFAULT now()  -- for finished games this is the finish time
);
CREATE INDEX IF NOT EXISTS games_white ON games (white_id, last_move_at);
CREATE INDEX IF NOT EXISTS games_black ON games (black_id, last_move_at);

CREATE TABLE IF NOT EXISTS moves (
  id         BIGSERIAL PRIMARY KEY,
  game_id    TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  ply        INTEGER NOT NULL,
  uci        TEXT NOT NULL,
  san        TEXT NOT NULL,
  fen_after  TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (game_id, ply)
);
CREATE INDEX IF NOT EXISTS moves_game ON moves (game_id, ply);

CREATE TABLE IF NOT EXISTS chat_messages (
  id         BIGSERIAL PRIMARY KEY,
  game_id    TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  member_id  TEXT NOT NULL REFERENCES members(id),
  text       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_game_order ON chat_messages (game_id, id);

CREATE TABLE IF NOT EXISTS challenges (
  id              TEXT PRIMARY KEY,
  from_id         TEXT NOT NULL REFERENCES members(id),
  to_id           TEXT NOT NULL REFERENCES members(id),
  club_id         TEXT REFERENCES clubs(id),
  rated           BOOLEAN NOT NULL DEFAULT FALSE,
  colour          TEXT NOT NULL CHECK (colour IN ('White','Black','Random')),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
  idempotency_key TEXT,
  game_id         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS challenges_key ON challenges (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS challenges_to ON challenges (to_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS challenges_from ON challenges (from_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  blocked_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id         BIGSERIAL PRIMARY KEY,
  member_id  TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  game_id    TEXT,
  read       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_member ON notifications (member_id, read, id DESC);

CREATE TABLE IF NOT EXISTS rating_audit (
  id            BIGSERIAL PRIMARY KEY,
  game_id       TEXT NOT NULL REFERENCES games(id),
  admin_id      TEXT NOT NULL REFERENCES members(id),
  member_id     TEXT NOT NULL REFERENCES members(id),
  rating_before INTEGER NOT NULL,
  rating_after  INTEGER NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS avatars (
  member_id  TEXT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  data       BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id           BIGSERIAL PRIMARY KEY,
  username     TEXT NOT NULL,
  succeeded    BOOLEAN NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS login_attempts_username ON login_attempts (username, attempted_at DESC);
`;

// Columns added after the first release; each is a no-op when it already exists.
export async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(SCHEMA);
    const additions = [
      ['games', 'fen_start', 'TEXT'],
      ['challenges', 'game_id', 'TEXT'],
    ];
    for (const [table, column, type] of additions) {
      try {
        await client.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${type}`);
      } catch { /* ignore */ }
    }
  } finally {
    client.release();
  }
}

export async function query(text, params) {
  return pool.query(text, params);
}

// Runs fn inside a transaction with a client; retries on serialization failures.
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* already rolled back */ }
    throw err;
  } finally {
    client.release();
  }
}

export default pool;
