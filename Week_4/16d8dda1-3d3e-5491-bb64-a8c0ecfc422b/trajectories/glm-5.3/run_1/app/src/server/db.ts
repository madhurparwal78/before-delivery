import pg from 'pg'
import { config } from './config.js'

const { Pool } = pg

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10
})

const SCHEMA = `
CREATE TABLE IF NOT EXISTS worlds (
  id text PRIMARY KEY,
  clock_mode text NOT NULL DEFAULT 'realtime',
  clock_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO worlds (id, clock_mode, clock_at) VALUES ('default', 'realtime', now())
  ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS teachers (
  id text PRIMARY KEY,
  world_id text NOT NULL REFERENCES worlds(id),
  email text NOT NULL,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  UNIQUE (world_id, email)
);

CREATE TABLE IF NOT EXISTS teacher_sessions (
  token text PRIMARY KEY,
  teacher_id text NOT NULL REFERENCES teachers(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS classes (
  id text PRIMARY KEY,
  world_id text NOT NULL REFERENCES worlds(id),
  owner_id text NOT NULL REFERENCES teachers(id),
  title text NOT NULL,
  time_zone text NOT NULL,
  code text UNIQUE NOT NULL,
  layout jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS co_teachers (
  class_id text NOT NULL REFERENCES classes(id),
  teacher_id text NOT NULL REFERENCES teachers(id),
  PRIMARY KEY (class_id, teacher_id)
);

CREATE TABLE IF NOT EXISTS lessons (
  id text PRIMARY KEY,
  world_id text NOT NULL REFERENCES worlds(id),
  class_id text NOT NULL REFERENCES classes(id),
  title text NOT NULL,
  state text NOT NULL DEFAULT 'draft'
);

CREATE TABLE IF NOT EXISTS lesson_files (
  id text PRIMARY KEY,
  world_id text NOT NULL REFERENCES worlds(id),
  lesson_id text NOT NULL REFERENCES lessons(id),
  kind text NOT NULL,
  name text NOT NULL,
  bytes integer NOT NULL,
  number integer NOT NULL,
  status text NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  world_id text NOT NULL REFERENCES worlds(id),
  class_id text NOT NULL REFERENCES classes(id),
  lesson_id text NOT NULL REFERENCES lessons(id),
  state text NOT NULL DEFAULT 'scheduled',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  current_slide integer NOT NULL DEFAULT 1,
  locked boolean NOT NULL DEFAULT false,
  hands_taken integer NOT NULL DEFAULT 0,
  breakout_rounds integer NOT NULL DEFAULT 0,
  ended_at timestamptz
);

CREATE TABLE IF NOT EXISTS learners (
  id text PRIMARY KEY,
  world_id text NOT NULL REFERENCES worlds(id),
  display_name text NOT NULL
);

CREATE TABLE IF NOT EXISTS enrolments (
  class_id text NOT NULL REFERENCES classes(id),
  learner_id text NOT NULL REFERENCES learners(id),
  PRIMARY KEY (class_id, learner_id)
);

CREATE TABLE IF NOT EXISTS session_learners (
  session_id text NOT NULL REFERENCES sessions(id),
  learner_id text NOT NULL REFERENCES learners(id),
  seat_id text,
  PRIMARY KEY (session_id, learner_id)
);

CREATE TABLE IF NOT EXISTS presence_intervals (
  id bigserial PRIMARY KEY,
  session_id text NOT NULL REFERENCES sessions(id),
  learner_id text NOT NULL REFERENCES learners(id),
  joined_at timestamptz NOT NULL,
  left_at timestamptz,
  seeded_open boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS attendance_rows (
  session_id text NOT NULL REFERENCES sessions(id),
  learner_id text NOT NULL REFERENCES learners(id),
  status text NOT NULL,
  first_joined timestamptz,
  last_left timestamptz,
  visits integer NOT NULL,
  PRIMARY KEY (session_id, learner_id)
);

CREATE TABLE IF NOT EXISTS polls (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES sessions(id),
  question text NOT NULL,
  options jsonb NOT NULL,
  state text NOT NULL DEFAULT 'open',
  opened_at timestamptz NOT NULL DEFAULT now(),
  total integer,
  results jsonb
);

CREATE TABLE IF NOT EXISTS poll_answers (
  poll_id text NOT NULL REFERENCES polls(id),
  learner_id text NOT NULL REFERENCES learners(id),
  option_number integer NOT NULL,
  PRIMARY KEY (poll_id, learner_id)
);

CREATE TABLE IF NOT EXISTS breakout_rounds (
  id bigserial PRIMARY KEY,
  session_id text NOT NULL REFERENCES sessions(id),
  tables integer NOT NULL,
  started_at timestamptz NOT NULL,
  deadline timestamptz NOT NULL,
  ended_at timestamptz,
  assignments jsonb NOT NULL,
  warned boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES sessions(id),
  table_id text NOT NULL,
  author_id text,
  author_name text NOT NULL,
  text text NOT NULL,
  sent_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS sign_in_tokens (
  token text PRIMARY KEY,
  person_type text NOT NULL,
  person_id text NOT NULL,
  used boolean NOT NULL DEFAULT false,
  world_id text NOT NULL REFERENCES worlds(id)
);

CREATE INDEX IF NOT EXISTS idx_files_lesson ON lesson_files(lesson_id);
CREATE INDEX IF NOT EXISTS idx_sessions_class ON sessions(class_id);
CREATE INDEX IF NOT EXISTS idx_presence_session ON presence_intervals(session_id, learner_id);
CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_messages(session_id, table_id, sent_at);
`

export async function initDb(): Promise<void> {
  await pool.query(SCHEMA)
}
