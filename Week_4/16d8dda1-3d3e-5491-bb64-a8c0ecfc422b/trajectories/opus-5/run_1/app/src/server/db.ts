import { Pool, types } from 'pg';
import type { QueryResultRow } from 'pg';
import { config } from './config.js';

types.setTypeParser(types.builtins.INT8, (value) => Number(value));

export const pool = new Pool({ connectionString: config.databaseUrl, max: 12 });

export async function query<Row extends QueryResultRow>(text: string, values: unknown[] = []): Promise<Row[]> {
  const result = await pool.query<Row>(text, values);
  return result.rows;
}

export async function queryOne<Row extends QueryResultRow>(text: string, values: unknown[] = []): Promise<Row | null> {
  const rows = await query<Row>(text, values);
  return rows[0] ?? null;
}

const schema = `
CREATE TABLE IF NOT EXISTS worlds (
  id text PRIMARY KEY,
  clock_now timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS teachers (
  id text PRIMARY KEY,
  world_id text NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  email text NOT NULL,
  email_lower text NOT NULL,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS teachers_world_email ON teachers (world_id, email_lower);

CREATE TABLE IF NOT EXISTS learners (
  id text PRIMARY KEY,
  world_id text NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id text PRIMARY KEY,
  teacher_id text REFERENCES teachers(id) ON DELETE CASCADE,
  learner_id text REFERENCES learners(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sign_in_tokens (
  token text PRIMARY KEY,
  teacher_id text REFERENCES teachers(id) ON DELETE CASCADE,
  learner_id text REFERENCES learners(id) ON DELETE CASCADE,
  used boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS classes (
  id text PRIMARY KEY,
  world_id text NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  owner_id text NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  title text NOT NULL,
  time_zone text NOT NULL,
  code text NOT NULL UNIQUE,
  layout jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS class_co_teachers (
  class_id text NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  teacher_id text NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (class_id, teacher_id)
);

CREATE TABLE IF NOT EXISTS enrolments (
  class_id text NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  learner_id text NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (class_id, learner_id)
);

CREATE TABLE IF NOT EXISTS lessons (
  id text PRIMARY KEY,
  world_id text NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  class_id text NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  title text NOT NULL,
  state text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lesson_files (
  id text PRIMARY KEY,
  lesson_id text NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  kind text NOT NULL,
  name text NOT NULL,
  content_type text NOT NULL,
  bytes integer NOT NULL,
  status text NOT NULL,
  position integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  world_id text NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  class_id text NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  lesson_id text NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  state text NOT NULL,
  starts_at_local text NOT NULL,
  ends_at_local text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  current_slide integer NOT NULL DEFAULT 1,
  locked boolean NOT NULL DEFAULT false,
  spotlight text,
  hands_taken integer NOT NULL DEFAULT 0,
  breakout_rounds integer NOT NULL DEFAULT 0,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS session_learners (
  session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  learner_id text NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  via_join boolean NOT NULL DEFAULT false,
  PRIMARY KEY (session_id, learner_id)
);

CREATE TABLE IF NOT EXISTS session_seats (
  session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seat_id text NOT NULL,
  learner_id text NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  PRIMARY KEY (session_id, seat_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS session_seats_one_each ON session_seats (session_id, learner_id);

CREATE TABLE IF NOT EXISTS session_hands (
  session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  learner_id text NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  raised_at bigint NOT NULL,
  PRIMARY KEY (session_id, learner_id)
);

CREATE TABLE IF NOT EXISTS presence (
  id bigserial PRIMARY KEY,
  session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  learner_id text NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL,
  left_at timestamptz
);
CREATE INDEX IF NOT EXISTS presence_session_learner ON presence (session_id, learner_id);

CREATE TABLE IF NOT EXISTS connections (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  learner_id text NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  instance text NOT NULL,
  grace_seconds integer NOT NULL,
  opened_at timestamptz NOT NULL,
  closed_at timestamptz
);
CREATE INDEX IF NOT EXISTS connections_open ON connections (session_id, learner_id, closed_at);

CREATE TABLE IF NOT EXISTS polls (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  question text NOT NULL,
  options jsonb NOT NULL,
  state text NOT NULL,
  opened_at timestamptz NOT NULL,
  closed_at timestamptz,
  total integer,
  results jsonb,
  position bigserial
);

CREATE TABLE IF NOT EXISTS poll_answers (
  poll_id text NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  learner_id text NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  option integer NOT NULL,
  PRIMARY KEY (poll_id, learner_id)
);

CREATE TABLE IF NOT EXISTS breakout_rounds (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  tables integer NOT NULL,
  started_at timestamptz NOT NULL,
  deadline timestamptz NOT NULL,
  length_seconds integer NOT NULL,
  warning_seconds integer NOT NULL,
  warned boolean NOT NULL DEFAULT false,
  ended_at timestamptz
);
CREATE INDEX IF NOT EXISTS breakout_rounds_running ON breakout_rounds (session_id, ended_at);

CREATE TABLE IF NOT EXISTS breakout_members (
  round_id text NOT NULL REFERENCES breakout_rounds(id) ON DELETE CASCADE,
  learner_id text NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  table_id text NOT NULL,
  PRIMARY KEY (round_id, learner_id)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  table_id text NOT NULL,
  author text NOT NULL,
  text text NOT NULL,
  sent_at timestamptz NOT NULL,
  position bigserial
);
CREATE INDEX IF NOT EXISTS chat_by_table ON chat_messages (session_id, table_id, position);

CREATE TABLE IF NOT EXISTS attendance (
  session_id text NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  learner_id text NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  status text NOT NULL,
  first_joined timestamptz,
  last_left timestamptz,
  visits integer NOT NULL,
  PRIMARY KEY (session_id, learner_id)
);

CREATE TABLE IF NOT EXISTS summaries (
  session_id text PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  body jsonb NOT NULL,
  written_at timestamptz NOT NULL
);

INSERT INTO worlds (id, clock_now) VALUES ('wld_default', NULL) ON CONFLICT (id) DO NOTHING;
`;

export const DEFAULT_WORLD = 'wld_default';

/**
 * The app creates its schema every time it starts to serve. Several instances
 * boot together, so one advisory lock keeps the statements from racing.
 */
export async function createSchema(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(728913001)');
    await client.query(schema);
  } finally {
    await client.query('SELECT pg_advisory_unlock(728913001)');
    client.release();
  }
}
