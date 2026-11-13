import { query } from './pool.js';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS quizmasters (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  email_lower text NOT NULL,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS quizmasters_email_lower_key ON quizmasters (email_lower);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  quizmaster_id uuid NOT NULL REFERENCES quizmasters(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS decks (
  id uuid PRIMARY KEY,
  quizmaster_id uuid NOT NULL REFERENCES quizmasters(id) ON DELETE CASCADE,
  title text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS decks_quizmaster_idx ON decks (quizmaster_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS questions (
  id uuid PRIMARY KEY,
  deck_id uuid NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  position integer NOT NULL,
  version integer NOT NULL DEFAULT 1,
  type text NOT NULL,
  prompt text NOT NULL,
  time_limit_seconds integer NOT NULL,
  spec jsonb NOT NULL,
  image jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS questions_deck_position_idx ON questions (deck_id, position);

CREATE TABLE IF NOT EXISTS rooms (
  id uuid PRIMARY KEY,
  quizmaster_id uuid NOT NULL REFERENCES quizmasters(id) ON DELETE CASCADE,
  deck_id uuid REFERENCES decks(id) ON DELETE SET NULL,
  deck_title text NOT NULL,
  pin text NOT NULL,
  state text NOT NULL,
  questions jsonb NOT NULL,
  question_index integer,
  opens_at bigint,
  deadline_at bigint,
  shuffled_ids jsonb,
  next_event_id bigint NOT NULL DEFAULT 1,
  presence_hash text,
  empty_since timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  end_reason text
);
CREATE UNIQUE INDEX IF NOT EXISTS rooms_live_pin_key ON rooms (pin) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS rooms_quizmaster_ended_idx ON rooms (quizmaster_id, ended_at DESC);

CREATE TABLE IF NOT EXISTS seats (
  id uuid PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  nickname text NOT NULL,
  nickname_lower text NOT NULL,
  rejoin_token_hash text NOT NULL,
  client_id text,
  score integer NOT NULL DEFAULT 0,
  streak integer NOT NULL DEFAULT 0,
  cumulative_ms bigint NOT NULL DEFAULT 0,
  joined_after_index integer NOT NULL DEFAULT 0,
  join_seq bigserial NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS seats_room_nickname_key ON seats (room_id, nickname_lower);
CREATE UNIQUE INDEX IF NOT EXISTS seats_rejoin_token_key ON seats (rejoin_token_hash);
CREATE INDEX IF NOT EXISTS seats_room_idx ON seats (room_id, join_seq);

CREATE TABLE IF NOT EXISTS answers (
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  seat_id uuid NOT NULL REFERENCES seats(id) ON DELETE CASCADE,
  question_index integer NOT NULL,
  latency_ms integer NOT NULL,
  points integer,
  received_at timestamptz NOT NULL DEFAULT now(),
  submission jsonb NOT NULL,
  PRIMARY KEY (room_id, seat_id, question_index)
);
CREATE INDEX IF NOT EXISTS answers_room_question_idx ON answers (room_id, question_index);

CREATE TABLE IF NOT EXISTS standings (
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  seat_id uuid NOT NULL REFERENCES seats(id) ON DELETE CASCADE,
  nickname text NOT NULL,
  score integer NOT NULL,
  streak integer NOT NULL,
  cumulative_ms bigint NOT NULL,
  rank integer NOT NULL,
  PRIMARY KEY (room_id, seat_id)
);
CREATE INDEX IF NOT EXISTS standings_room_rank_idx ON standings (room_id, rank);

CREATE TABLE IF NOT EXISTS room_events (
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  id bigint NOT NULL,
  type text NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, id)
);

CREATE TABLE IF NOT EXISTS room_transitions (
  seq bigserial PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  command text,
  from_state text NOT NULL,
  to_state text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS room_transitions_room_idx ON room_transitions (room_id, seq);

CREATE TABLE IF NOT EXISTS room_reveals (
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  question_index integer NOT NULL,
  data jsonb NOT NULL,
  PRIMARY KEY (room_id, question_index)
);

CREATE TABLE IF NOT EXISTS room_clients (
  client_id text PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  seat_id uuid REFERENCES seats(id) ON DELETE CASCADE,
  role text NOT NULL,
  retired boolean NOT NULL DEFAULT false,
  stream_open boolean NOT NULL DEFAULT false,
  stream_seen_at timestamptz,
  last_poll_at timestamptz
);
CREATE INDEX IF NOT EXISTS room_clients_room_idx ON room_clients (room_id);
`;

export async function applySchema(): Promise<void> {
  await query(SCHEMA_SQL);
  // Streams from an earlier run of this instance are gone with the process.
  await query('UPDATE room_clients SET stream_open = false WHERE stream_open = true');
}
