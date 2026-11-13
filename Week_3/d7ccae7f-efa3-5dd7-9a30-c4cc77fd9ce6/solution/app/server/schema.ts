export const schemaSql = `
CREATE TABLE IF NOT EXISTS quizmasters (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  email_key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  created_at bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  quizmaster_id uuid NOT NULL REFERENCES quizmasters(id) ON DELETE CASCADE,
  expires_at bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS decks (
  id uuid PRIMARY KEY,
  quizmaster_id uuid NOT NULL REFERENCES quizmasters(id) ON DELETE CASCADE,
  title text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  updated_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS decks_owner ON decks (quizmaster_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS questions (
  id uuid PRIMARY KEY,
  deck_id uuid NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  position integer NOT NULL,
  version integer NOT NULL DEFAULT 1,
  type text NOT NULL,
  prompt text NOT NULL,
  time_limit_seconds integer NOT NULL,
  fields jsonb NOT NULL,
  image jsonb
);
CREATE INDEX IF NOT EXISTS questions_deck ON questions (deck_id, position);
CREATE TABLE IF NOT EXISTS rooms (
  id uuid PRIMARY KEY,
  quizmaster_id uuid NOT NULL REFERENCES quizmasters(id) ON DELETE CASCADE,
  deck_title text NOT NULL,
  pin char(6) NOT NULL,
  state text NOT NULL,
  question_index integer,
  question_count integer NOT NULL,
  last_event_id bigint NOT NULL DEFAULT 0,
  created_at bigint NOT NULL,
  ended_at bigint,
  end_reason text
);
CREATE UNIQUE INDEX IF NOT EXISTS rooms_live_pin ON rooms (pin) WHERE state <> 'ended';
CREATE INDEX IF NOT EXISTS rooms_owner_ended ON rooms (quizmaster_id, ended_at DESC) WHERE state = 'ended';
CREATE INDEX IF NOT EXISTS rooms_open ON rooms (state) WHERE state <> 'ended';
CREATE TABLE IF NOT EXISTS room_questions (
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  index integer NOT NULL,
  type text NOT NULL,
  prompt text NOT NULL,
  time_limit_ms integer NOT NULL,
  source_version integer NOT NULL,
  fields jsonb NOT NULL,
  image jsonb,
  opens_at bigint,
  deadline_at bigint,
  reveal jsonb,
  PRIMARY KEY (room_id, index)
);
CREATE TABLE IF NOT EXISTS room_transitions (
  id bigserial PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  command text NOT NULL,
  from_state text NOT NULL,
  to_state text NOT NULL,
  question_index integer,
  actor text NOT NULL,
  at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS room_transitions_room ON room_transitions (room_id, id);
CREATE TABLE IF NOT EXISTS seats (
  id uuid PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  nickname text NOT NULL,
  nickname_key text NOT NULL,
  rejoin_token_hash text NOT NULL UNIQUE,
  join_seq integer NOT NULL,
  joined_at bigint NOT NULL,
  score integer NOT NULL DEFAULT 0,
  streak integer NOT NULL DEFAULT 0,
  cumulative_ms bigint NOT NULL DEFAULT 0,
  UNIQUE (room_id, nickname_key)
);
CREATE TABLE IF NOT EXISTS clients (
  client_id text PRIMARY KEY,
  seat_id uuid NOT NULL REFERENCES seats(id) ON DELETE CASCADE,
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  retired boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS clients_seat ON clients (seat_id);
CREATE TABLE IF NOT EXISTS answers (
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  seat_id uuid NOT NULL REFERENCES seats(id) ON DELETE CASCADE,
  question_index integer NOT NULL,
  latency_ms integer NOT NULL,
  points integer,
  received_at timestamptz NOT NULL,
  given jsonb NOT NULL,
  PRIMARY KEY (room_id, seat_id, question_index)
);
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
CREATE TABLE IF NOT EXISTS room_events (
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  id bigint NOT NULL,
  type text NOT NULL,
  data jsonb NOT NULL,
  PRIMARY KEY (room_id, id)
);
`;
