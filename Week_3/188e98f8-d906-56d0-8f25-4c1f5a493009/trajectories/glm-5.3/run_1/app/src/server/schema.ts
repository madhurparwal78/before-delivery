export const SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS league_meta (
     key text PRIMARY KEY,
     value text NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS teams (
     id integer PRIMARY KEY,
     name text NOT NULL UNIQUE,
     captain_email text NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS desk_codes (
     code text PRIMARY KEY,
     role text NOT NULL,
     team_id integer
   )`,
  `CREATE TABLE IF NOT EXISTS rounds (
     number integer PRIMARY KEY,
     title text NOT NULL,
     kind text NOT NULL,
     status text NOT NULL,
     opened_at timestamptz,
     closes_at timestamptz,
     closed_at timestamptz
   )`,
  `CREATE TABLE IF NOT EXISTS sheets (
     round integer PRIMARY KEY REFERENCES rounds(number),
     key text NOT NULL,
     sha256 text NOT NULL,
     size integer NOT NULL,
     width integer NOT NULL,
     height integer NOT NULL,
     content_type text NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS answers (
     id bigserial PRIMARY KEY,
     round integer NOT NULL,
     team_id integer NOT NULL,
     question integer NOT NULL,
     text text NOT NULL,
     submitted_at timestamptz NOT NULL,
     current boolean NOT NULL,
     mark integer,
     ruled integer
   )`,
  `CREATE INDEX IF NOT EXISTS answers_archive_order ON answers (submitted_at, id)`,
  `CREATE INDEX IF NOT EXISTS answers_current ON answers (round, team_id, question)`,
  `CREATE TABLE IF NOT EXISTS disputes (
     id bigserial PRIMARY KEY,
     answer_id bigint NOT NULL,
     team_id integer NOT NULL,
     round integer NOT NULL,
     question integer NOT NULL,
     answer_text text NOT NULL,
     reason text NOT NULL,
     status text NOT NULL,
     raised_at timestamptz NOT NULL,
     ruled_at timestamptz,
     note text,
     UNIQUE (answer_id)
   )`,
  `CREATE TABLE IF NOT EXISTS idempotency_records (
     team_id integer NOT NULL,
     idem_key text NOT NULL,
     round integer NOT NULL,
     body text NOT NULL,
     status integer NOT NULL,
     response text NOT NULL,
     created_at timestamptz NOT NULL,
     PRIMARY KEY (team_id, idem_key)
   )`,
  `CREATE TABLE IF NOT EXISTS published_scores (
     team_id integer NOT NULL,
     round integer NOT NULL,
     score integer NOT NULL,
     PRIMARY KEY (team_id, round)
   )`,
  `CREATE TABLE IF NOT EXISTS sessions (
     token_hash text PRIMARY KEY,
     role text NOT NULL,
     team_id integer,
     created_at timestamptz NOT NULL
   )`,
];
