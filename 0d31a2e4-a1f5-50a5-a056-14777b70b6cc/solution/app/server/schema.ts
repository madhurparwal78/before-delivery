// The PostgreSQL schema, applied idempotently every time the server starts serving.

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
  handle TEXT NOT NULL CHECK (handle ~ '^[a-z0-9_]{3,20}$'),
  password_hash TEXT NOT NULL,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_handle_key ON users (lower(handle));

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);

CREATE TABLE IF NOT EXISTS link_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('verify', 'reset')),
  token_hash TEXT NOT NULL UNIQUE,
  sent_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('sending', 'active', 'used', 'replaced', 'failed'))
);
CREATE INDEX IF NOT EXISTS link_tokens_user ON link_tokens (user_id, kind);

CREATE TABLE IF NOT EXISTS friend_requests (
  id SERIAL PRIMARY KEY,
  from_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sent_at TIMESTAMPTZ NOT NULL,
  CHECK (from_id <> to_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS friend_requests_pair ON friend_requests (LEAST(from_id, to_id), GREATEST(from_id, to_id));

CREATE TABLE IF NOT EXISTS friendships (
  low_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  high_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  since TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (low_id, high_id),
  CHECK (low_id < high_id)
);

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

CREATE TABLE IF NOT EXISTS lobbies (
  id SERIAL PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('filling', 'countdown', 'running', 'finished')),
  countdown_ends_at TIMESTAMPTZ,
  match_id INTEGER,
  host_instance TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS parties (
  id SERIAL PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('idle', 'queued', 'in_lobby', 'in_match')),
  leader_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lobby_id INTEGER REFERENCES lobbies(id),
  match_id INTEGER,
  queued_at TIMESTAMPTZ,
  queued_via TEXT,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS party_members (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  party_id INTEGER NOT NULL REFERENCES parties(id),
  joined_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS party_members_party ON party_members (party_id);

CREATE TABLE IF NOT EXISTS party_invites (
  id SERIAL PRIMARY KEY,
  party_id INTEGER NOT NULL REFERENCES parties(id),
  from_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sent_at TIMESTAMPTZ NOT NULL,
  UNIQUE (party_id, to_id)
);

CREATE TABLE IF NOT EXISTS seats (
  lobby_id INTEGER NOT NULL REFERENCES lobbies(id),
  seat INTEGER NOT NULL CHECK (seat BETWEEN 1 AND 12),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  party_id INTEGER NOT NULL REFERENCES parties(id),
  seated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (lobby_id, seat),
  UNIQUE (lobby_id, user_id)
);

CREATE TABLE IF NOT EXISTS matches (
  id SERIAL PRIMARY KEY,
  lobby_id INTEGER REFERENCES lobbies(id),
  state TEXT NOT NULL CHECK (state IN ('running', 'finished')),
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  winner_id INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS match_participants (
  match_id INTEGER NOT NULL REFERENCES matches(id),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (match_id, user_id)
);
CREATE INDEX IF NOT EXISTS match_participants_user ON match_participants (user_id);

CREATE TABLE IF NOT EXISTS rounds (
  id SERIAL PRIMARY KEY,
  match_id INTEGER NOT NULL REFERENCES matches(id),
  n INTEGER NOT NULL CHECK (n BETWEEN 1 AND 3),
  kind TEXT NOT NULL CHECK (kind IN ('race', 'survival', 'final')),
  seed BIGINT NOT NULL CHECK (seed BETWEEN 0 AND 4294967295),
  state TEXT NOT NULL CHECK (state IN ('pending', 'running', 'resolved')),
  starters INTEGER[] NOT NULL,
  slots INTEGER NOT NULL,
  last_tick INTEGER,
  UNIQUE (match_id, n)
);

CREATE TABLE IF NOT EXISTS round_results (
  round_id INTEGER NOT NULL REFERENCES rounds(id),
  user_id INTEGER NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('qualified', 'eliminated')),
  finish_tick INTEGER,
  eliminated_tick INTEGER,
  position INTEGER NOT NULL,
  PRIMARY KEY (round_id, user_id)
);

CREATE TABLE IF NOT EXISTS round_inputs (
  round_id INTEGER NOT NULL REFERENCES rounds(id),
  tick INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  buttons INTEGER NOT NULL CHECK (buttons BETWEEN 0 AND 63),
  PRIMARY KEY (round_id, tick, user_id)
);

CREATE TABLE IF NOT EXISTS round_forfeits (
  round_id INTEGER NOT NULL REFERENCES rounds(id),
  user_id INTEGER NOT NULL,
  tick INTEGER NOT NULL,
  PRIMARY KEY (round_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  channel TEXT NOT NULL CHECK (channel IN ('party', 'dm')),
  party_id INTEGER REFERENCES parties(id),
  from_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  sent_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_party ON messages (party_id, id);
CREATE INDEX IF NOT EXISTS messages_dm ON messages (LEAST(from_user_id, to_user_id), GREATEST(from_user_id, to_user_id), id);
CREATE INDEX IF NOT EXISTS messages_sender ON messages (from_user_id, sent_at);

CREATE TABLE IF NOT EXISTS socket_users (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  instance_id TEXT NOT NULL,
  PRIMARY KEY (user_id, instance_id)
);

CREATE TABLE IF NOT EXISTS server_instances (
  id TEXT PRIMARY KEY,
  seen_at TIMESTAMPTZ NOT NULL
);
`;
