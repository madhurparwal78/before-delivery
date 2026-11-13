/** Schema applied on every serve. Every statement is idempotent. */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS league (
  id int PRIMARY KEY CHECK (id = 1),
  name text NOT NULL,
  season text NOT NULL,
  pub text NOT NULL,
  night int NOT NULL,
  table_version int NOT NULL
);
CREATE TABLE IF NOT EXISTS teams (
  id int PRIMARY KEY,
  name text NOT NULL,
  name_key text NOT NULL UNIQUE,
  captain_email text NOT NULL
);
CREATE TABLE IF NOT EXISTS desk_codes (
  code text PRIMARY KEY,
  role text NOT NULL,
  team_id int REFERENCES teams (id)
);
CREATE TABLE IF NOT EXISTS past_scores (
  team_id int NOT NULL REFERENCES teams (id),
  night int NOT NULL,
  score int NOT NULL,
  PRIMARY KEY (team_id, night)
);
CREATE TABLE IF NOT EXISTS rounds (
  number int PRIMARY KEY,
  title text NOT NULL,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'drafted',
  opened_at timestamptz,
  closes_at timestamptz,
  closed_at timestamptz,
  published_at timestamptz,
  sheet_key text,
  sheet_content_type text,
  sheet_size int,
  sheet_sha256 text,
  sheet_width int,
  sheet_height int
);
CREATE UNIQUE INDEX IF NOT EXISTS rounds_one_open ON rounds (status) WHERE status = 'open';
CREATE TABLE IF NOT EXISTS answers (
  id bigserial PRIMARY KEY,
  round int NOT NULL REFERENCES rounds (number),
  team_id int NOT NULL REFERENCES teams (id),
  question int NOT NULL,
  text text NOT NULL,
  search_text text NOT NULL,
  submitted_at timestamptz NOT NULL,
  current boolean NOT NULL DEFAULT true,
  mark smallint CHECK (mark IN (0, 1))
);
CREATE INDEX IF NOT EXISTS answers_round_current ON answers (round, question, team_id) WHERE current;
CREATE TABLE IF NOT EXISTS disputes (
  id serial PRIMARY KEY,
  answer_id bigint NOT NULL UNIQUE REFERENCES answers (id),
  team_id int NOT NULL REFERENCES teams (id),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'raised',
  raised_at timestamptz NOT NULL,
  ruled_at timestamptz,
  note text
);
CREATE TABLE IF NOT EXISTS submit_log (
  id bigserial PRIMARY KEY,
  team_id int NOT NULL REFERENCES teams (id),
  at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS submit_log_team_at ON submit_log (team_id, at);
CREATE TABLE IF NOT EXISTS idempotency (
  team_id int NOT NULL REFERENCES teams (id),
  key text NOT NULL,
  round int NOT NULL,
  body jsonb NOT NULL,
  response jsonb NOT NULL,
  PRIMARY KEY (team_id, key)
);
CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  role text NOT NULL,
  team_id int REFERENCES teams (id)
);
CREATE OR REPLACE VIEW ruled_answers AS
  SELECT a.*,
    CASE WHEN a.mark IS NULL THEN NULL WHEN d.status = 'upheld' THEN 1 ELSE a.mark END AS ruled
  FROM answers a LEFT JOIN disputes d ON d.answer_id = a.id;
`;
