import { query } from './db.js';

const STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS users (
    id serial PRIMARY KEY,
    email text NOT NULL UNIQUE,
    handle text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    email_verified boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token text PRIMARY KEY,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS link_tokens (
    token text PRIMARY KEY,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('verification', 'reset')),
    sent_at_ms bigint NOT NULL,
    used boolean NOT NULL DEFAULT false,
    invalidated boolean NOT NULL DEFAULT false
  )`,
  `CREATE TABLE IF NOT EXISTS friendships (
    low_user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    high_user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    since timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (low_user_id, high_user_id),
    CHECK (low_user_id < high_user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS friend_requests (
    id serial PRIMARY KEY,
    from_user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sent_at timestamptz NOT NULL DEFAULT now(),
    CHECK (from_user_id <> to_user_id)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS friend_requests_one_per_pair
    ON friend_requests (least(from_user_id, to_user_id), greatest(from_user_id, to_user_id))`,
  `CREATE TABLE IF NOT EXISTS blocks (
    blocker_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (blocker_id, blocked_id),
    CHECK (blocker_id <> blocked_id)
  )`,
  `CREATE TABLE IF NOT EXISTS lobbies (
    id serial PRIMARY KEY,
    state text NOT NULL DEFAULT 'filling'
      CHECK (state IN ('filling', 'countdown', 'running', 'finished')),
    countdown_ends_at timestamptz,
    match_id integer,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS matches (
    id serial PRIMARY KEY,
    lobby_id integer NOT NULL REFERENCES lobbies(id),
    state text NOT NULL DEFAULT 'running' CHECK (state IN ('running', 'finished')),
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    winner_id integer REFERENCES users(id)
  )`,
  `CREATE TABLE IF NOT EXISTS match_participants (
    match_id integer NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (match_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS parties (
    id serial PRIMARY KEY,
    state text NOT NULL DEFAULT 'idle'
      CHECK (state IN ('idle', 'queued', 'in_lobby', 'in_match')),
    leader_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lobby_id integer REFERENCES lobbies(id),
    match_id integer REFERENCES matches(id),
    queued_at timestamptz
  )`,
  `CREATE TABLE IF NOT EXISTS party_members (
    party_id integer NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
    user_id integer NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    joined_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (party_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS party_invites (
    id serial PRIMARY KEY,
    party_id integer NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
    from_user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sent_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (party_id, to_user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS lobby_seats (
    lobby_id integer NOT NULL REFERENCES lobbies(id) ON DELETE CASCADE,
    seat integer NOT NULL CHECK (seat >= 1 AND seat <= 12),
    user_id integer NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    party_id integer NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
    seated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (lobby_id, seat)
  )`,
  `CREATE TABLE IF NOT EXISTS rounds (
    id serial PRIMARY KEY,
    match_id integer NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    n integer NOT NULL,
    kind text NOT NULL CHECK (kind IN ('race', 'survival', 'final')),
    seed bigint NOT NULL,
    state text NOT NULL DEFAULT 'pending'
      CHECK (state IN ('pending', 'running', 'resolved')),
    starters integer[] NOT NULL,
    slots integer NOT NULL,
    last_tick integer,
    UNIQUE (match_id, n)
  )`,
  `CREATE TABLE IF NOT EXISTS round_results (
    round_id integer NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    outcome text NOT NULL CHECK (outcome IN ('qualified', 'eliminated')),
    finish_tick integer,
    eliminated_tick integer,
    position integer NOT NULL,
    PRIMARY KEY (round_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS round_inputs (
    round_id integer NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
    tick integer NOT NULL,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    buttons integer NOT NULL CHECK (buttons >= 0 AND buttons <= 63),
    PRIMARY KEY (round_id, tick, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS round_forfeits (
    round_id integer NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
    user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tick integer NOT NULL,
    PRIMARY KEY (round_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    id serial PRIMARY KEY,
    channel text NOT NULL CHECK (channel IN ('party', 'dm')),
    party_id integer REFERENCES parties(id) ON DELETE CASCADE,
    from_user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_user_id integer REFERENCES users(id) ON DELETE CASCADE,
    body text NOT NULL,
    sent_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS messages_party ON messages (party_id, id)`,
  `CREATE INDEX IF NOT EXISTS messages_dm ON messages (from_user_id, to_user_id, id)`,
];

export async function applySchema(): Promise<void> {
  for (const statement of STATEMENTS) await query(statement);
}
